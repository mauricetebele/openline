/**
 * Background label-batch processor.
 *
 * Called fire-and-forget from POST /api/orders/label-batch.
 * Runs entirely server-side so the browser can be closed mid-batch.
 *
 * If the function approaches the Vercel execution time limit (maxDuration=300s),
 * it saves progress and triggers a continuation via an internal API call,
 * allowing batches of unlimited size to process seamlessly.
 */
import { prisma } from '@/lib/prisma'
import { ShipStationClient, SSLabelPayload } from '@/lib/shipstation/client'
import { decrypt } from '@/lib/crypto'
import { loadFedExCredentials, createShipment, type FedExShipmentParams } from '@/lib/fedex/client'

/** Leave 30s of headroom before the Vercel timeout to safely chain */
const MAX_RUN_MS = 260_000 // 4 min 20s (out of 5 min maxDuration)

export async function runLabelBatch(batchId: string): Promise<void> {
  const startedAt = Date.now()

  // ── 1. Mark batch RUNNING ──────────────────────────────────────────────────
  await prisma.labelBatch.update({
    where: { id: batchId },
    data:  { status: 'RUNNING' },
  })

  // ── 2. Load ShipStation account & create client ───────────────────────────
  const ssAccount = await prisma.shipStationAccount.findFirst({
    where:   { isActive: true },
    orderBy: { createdAt: 'asc' },
    select:  { apiKeyEnc: true, apiSecretEnc: true, v2ApiKeyEnc: true },
  })
  if (!ssAccount) {
    await prisma.labelBatch.update({
      where: { id: batchId },
      data:  { status: 'FAILED', completedAt: new Date() },
    })
    throw new Error('No active ShipStation account found')
  }

  const v2ApiKey = ssAccount.v2ApiKeyEnc ? decrypt(ssAccount.v2ApiKeyEnc) : null
  const ssClient = new ShipStationClient(
    decrypt(ssAccount.apiKeyEnc),
    ssAccount.apiSecretEnc ? decrypt(ssAccount.apiSecretEnc) : '',
    v2ApiKey,
  )

  // ── 3. Fetch default warehouse ────────────────────────────────────────────
  const warehouses = ssClient.hasV1Auth
    ? await ssClient.getWarehouses()
    : await ssClient.getV2Warehouses()
  const warehouse  = warehouses.find(w => w.isDefault) ?? warehouses[0]
  if (!warehouse) {
    await prisma.labelBatch.update({
      where: { id: batchId },
      data:  { status: 'FAILED', completedAt: new Date() },
    })
    throw new Error('No warehouses configured in ShipStation')
  }

  const from           = warehouse.originAddress
  const fromPostalCode = from.postalCode.split('-')[0].trim()

  // ── 3b. Pre-load FedEx credentials (needed for fedex_direct labels) ──────
  const fedexCreds = await loadFedExCredentials()

  const FEDEX_PACKAGING_TYPES = new Set([
    'FEDEX_ENVELOPE', 'FEDEX_PAK', 'FEDEX_SMALL_BOX', 'FEDEX_MEDIUM_BOX',
    'FEDEX_LARGE_BOX', 'FEDEX_EXTRA_LARGE_BOX', 'FEDEX_TUBE',
  ])

  // ── 4. Load batch with PENDING items only ─────────────────────────────────
  const batch = await prisma.labelBatch.findUnique({
    where:   { id: batchId },
    include: {
      items: {
        where:   { status: 'PENDING' },
        include: {
          order: {
            include: { appliedPreset: true },
          },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  })
  if (!batch) throw new Error(`Batch ${batchId} not found`)

  // Nothing left to process — mark done
  if (batch.items.length === 0) {
    await prisma.labelBatch.update({
      where: { id: batchId },
      data:  { status: 'COMPLETED', completedAt: new Date() },
    })
    return
  }

  let completedCount = batch.completed
  let failedCount    = batch.failed

  // ── 5. Process each item sequentially ────────────────────────────────────
  for (const item of batch.items) {
    // ── Time check: if approaching the limit, stop gracefully ───────────────
    // The client polling loop will detect the stall and re-trigger /continue.
    if (Date.now() - startedAt > MAX_RUN_MS) {
      console.log('[LabelBatch] batch=%s approaching timeout after %ds, stopping for %d remaining items (client will re-trigger)',
        batchId, Math.round((Date.now() - startedAt) / 1000), batch.items.length - batch.items.indexOf(item))
      return // exit gracefully — client re-triggers via /continue
    }

    const order = item.order

    // Mark item RUNNING
    await prisma.labelBatchItem.update({
      where: { id: item.id },
      data:  { status: 'RUNNING' },
    })

    try {
      // Reject orders Amazon has already marked as shipped
      if (order.orderStatus === 'Shipped') {
        throw new Error('Order is already marked as Shipped on Amazon')
      }

      let trackingNumber: string
      let labelData: string
      let labelFormat: string
      let shipmentCost: number | undefined
      let carrier: string | undefined
      let serviceCode: string | undefined
      let ssShipmentId: string | undefined

      const isFedExDirect = order.presetRateCarrier === 'fedex_direct' ||
        order.appliedPreset?.carrierCode === 'fedex_direct'

      if (isFedExDirect) {
        // ── FedEx Direct path: create shipment via FedEx API ────────────────
        if (!fedexCreds) {
          throw new Error('FedEx credentials not configured — go to Settings → FedEx')
        }
        const preset = order.appliedPreset
        if (!preset) {
          throw new Error('No applied preset found on order — re-apply preset before batching')
        }
        if (!preset.serviceCode) {
          throw new Error('Preset has no service code — select a FedEx service on the preset')
        }

        const toPostalCode = (order.shipToPostal ?? '').split('-')[0].trim()
        if (!toPostalCode || !order.shipToCity) {
          throw new Error('Order ship-to address is incomplete — sync from ShipStation first')
        }

        const fedexWeightUnits: 'LB' | 'KG' =
          preset.weightUnit === 'grams' || preset.weightUnit === 'kilograms' ? 'KG' : 'LB'
        let fedexWeightValue = preset.weightValue
        if (preset.weightUnit === 'ounces') fedexWeightValue = preset.weightValue / 16
        else if (preset.weightUnit === 'grams') fedexWeightValue = preset.weightValue / 1000

        const fedexDimUnits: 'IN' | 'CM' =
          preset.dimUnit === 'centimeters' ? 'CM' : 'IN'

        const isFedExPackaging = preset.packageCode ? FEDEX_PACKAGING_TYPES.has(preset.packageCode) : false

        const shipParams: FedExShipmentParams = {
          shipFrom: {
            streetLines: [from.street1, from.street2].filter(Boolean) as string[],
            city: from.city,
            stateOrProvinceCode: from.state,
            postalCode: fromPostalCode,
            countryCode: from.country || 'US',
            personName: from.name,
            phone: from.phone ?? '555-555-5555',
          },
          shipTo: {
            streetLines: [order.shipToAddress1, order.shipToAddress2].filter(Boolean) as string[],
            city: order.shipToCity ?? '',
            stateOrProvinceCode: order.shipToState ?? '',
            postalCode: toPostalCode,
            countryCode: order.shipToCountry ?? 'US',
            personName: order.shipToName ?? '',
            phone: order.shipToPhone ?? '555-555-5555',
          },
          weight: { value: Math.max(fedexWeightValue, 0.1), units: fedexWeightUnits },
          dimensions: preset.dimLength && preset.dimWidth && preset.dimHeight
            ? { length: preset.dimLength, width: preset.dimWidth, height: preset.dimHeight, units: fedexDimUnits }
            : { length: 1, width: 1, height: 1, units: 'IN' },
          serviceType: preset.serviceCode,
          shipDate: order.presetShipDate ?? new Date().toISOString().slice(0, 10),
          ...(isFedExPackaging ? { packagingType: preset.packageCode!, oneRate: true } : {}),
        }

        const label = await createShipment(fedexCreds, shipParams, batch.isTest)
        trackingNumber = label.trackingNumber
        labelData      = label.labelData
        labelFormat    = label.labelFormat
        shipmentCost   = order.presetRateAmount ? Number(order.presetRateAmount) : undefined
        carrier        = 'fedex_direct'
        serviceCode    = preset.serviceCode

      } else if (order.presetRateId) {
        // ── V2 path: buy from captured rate ID ──────────────────────────────
        const label = await ssClient.createLabelV2FromRate(order.presetRateId, {
          testLabel: batch.isTest,
          shipDate: order.presetShipDate,
        })
        trackingNumber = label.trackingNumber
        labelData      = label.labelData
        labelFormat    = label.labelFormat
        shipmentCost   = label.shipmentCost
        carrier        = order.presetRateCarrier ?? undefined
        serviceCode    = order.presetRateService ?? undefined
        ssShipmentId   = label.shipmentId ? String(label.shipmentId) : undefined

      } else {
        // ── V1 path: direct createLabel with preset parameters ───────────────
        if (!order.presetRateCarrier) {
          throw new Error('No carrier captured on order — apply a preset first')
        }
        const preset = order.appliedPreset
        if (!preset) {
          throw new Error('No applied preset found on order — re-apply preset before batching')
        }
        if (!preset.serviceCode) {
          throw new Error(
            'Preset has no service code configured. ' +
            'For cheapest-rate presets, re-apply to capture the specific service, then batch again.',
          )
        }

        const toPostalCode = (order.shipToPostal ?? '').split('-')[0].trim()
        if (!toPostalCode || !order.shipToCity) {
          throw new Error('Order ship-to address is incomplete — sync from ShipStation first')
        }

        const dims: SSLabelPayload['dimensions'] =
          preset.dimLength && preset.dimWidth && preset.dimHeight
            ? {
                units:  preset.dimUnit as 'inches' | 'centimeters',
                length: preset.dimLength,
                width:  preset.dimWidth,
                height: preset.dimHeight,
              }
            : { units: 'inches', length: 1, width: 1, height: 1 }

        const labelPayload: SSLabelPayload = {
          carrierCode:  order.presetRateCarrier,
          serviceCode:  preset.serviceCode,
          packageCode:  preset.packageCode ?? undefined,
          confirmation: (preset.confirmation as SSLabelPayload['confirmation']) ?? undefined,
          shipDate:     order.presetShipDate ?? new Date().toISOString().slice(0, 10),
          weight: {
            value: preset.weightValue,
            units: preset.weightUnit as 'ounces' | 'pounds' | 'grams' | 'kilograms',
          },
          dimensions: dims,
          shipFrom: {
            name:       from.name,
            street1:    from.street1,
            street2:    from.street2 ?? undefined,
            city:       from.city,
            state:      from.state,
            postalCode: fromPostalCode,
            country:    from.country || 'US',
            phone:      from.phone ?? undefined,
          },
          shipTo: {
            name:       order.shipToName    ?? '',
            street1:    order.shipToAddress1 ?? '',
            street2:    order.shipToAddress2 ?? undefined,
            city:       order.shipToCity    ?? '',
            state:      order.shipToState   ?? '',
            postalCode: toPostalCode,
            country:    order.shipToCountry ?? 'US',
            phone:      order.shipToPhone   ?? undefined,
          },
          orderNumber: order.amazonOrderId,
          testLabel:   batch.isTest,
        }

        const label = await ssClient.createLabel(labelPayload)
        trackingNumber = label.trackingNumber
        labelData      = label.labelData
        labelFormat    = label.labelFormat
        shipmentCost   = label.shipmentCost
        carrier        = preset.carrierCode
        serviceCode    = preset.serviceCode
        ssShipmentId   = label.shipmentId ? String(label.shipmentId) : undefined
      }

      // ── Success: save label and advance order status ──────────────────────
      await prisma.orderLabel.upsert({
        where:  { orderId: order.id },
        create: {
          orderId:        order.id,
          trackingNumber,
          labelData,
          labelFormat,
          shipmentCost:   shipmentCost ?? null,
          carrier:        carrier      ?? null,
          serviceCode:    serviceCode  ?? null,
          isTest:         batch.isTest,
          ssShipmentId:   ssShipmentId ?? null,
        },
        update: {
          trackingNumber,
          labelData,
          labelFormat,
          shipmentCost:   shipmentCost ?? null,
          carrier:        carrier      ?? null,
          serviceCode:    serviceCode  ?? null,
          isTest:         batch.isTest,
          ssShipmentId:   ssShipmentId ?? null,
          createdAt:      new Date(),
        },
      })

      await prisma.order.update({
        where: { id: order.id },
        data:  { workflowStatus: 'AWAITING_VERIFICATION' },
      })

      completedCount++
      await prisma.labelBatchItem.update({
        where: { id: item.id },
        data:  { status: 'COMPLETED' },
      })
      await prisma.labelBatch.update({
        where: { id: batchId },
        data:  { completed: completedCount },
      })

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[LabelBatch] orderId=%s error=%s', order.id, msg)
      failedCount++
      await prisma.labelBatchItem.update({
        where: { id: item.id },
        data:  { status: 'FAILED', error: msg },
      })
      await prisma.labelBatch.update({
        where: { id: batchId },
        data:  { failed: failedCount },
      })
    }
  }

  // ── 6. Mark batch COMPLETED ───────────────────────────────────────────────
  await prisma.labelBatch.update({
    where: { id: batchId },
    data:  { status: 'COMPLETED', completedAt: new Date() },
  })
}

