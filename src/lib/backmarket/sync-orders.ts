/**
 * BackMarket order sync — fetches orders with state 1 (new/awaiting validation)
 * and state 3 (accepted/shipped) from the BackMarket API and upserts
 * them into the same orders table alongside Amazon orders.
 *
 * Field mapping:
 *   BM order_id       → amazonOrderId  (reused field for external order ID)
 *   BM state 1        → "Unshipped"    (orderStatus)
 *   BM state 2        → "Pending"      (orderStatus)
 *   BM date_creation  → purchaseDate
 *   BM date_modification → lastUpdateDate
 *   BM price          → orderTotal
 *   BM currency       → currency
 *   BM shipping_address.* → shipTo* fields
 *   fulfillmentChannel  = "BACKMARKET"
 *   orderSource         = "backmarket"
 */
import { prisma } from '@/lib/prisma'
import { decrypt } from '@/lib/crypto'
import { BackMarketClient } from './client'

// ─── BackMarket API types ───────────────────────────────────────────────────

interface BMShippingAddress {
  first_name?: string
  last_name?: string
  street?: string
  street2?: string
  city?: string
  state?: string
  // BM may use zipcode, postal_code, or zip depending on the API version
  zipcode?: string
  postal_code?: string
  zip?: string
  country?: string
  country_code?: string
  phone?: string
  [key: string]: unknown // catch any undocumented fields
}

interface BMOrderLine {
  id?: number | string
  listing?: string
  product?: string
  quantity?: number
  price?: string | number
  shipping_price?: string | number
  orderline_fee?: string | number
  sales_taxes?: string | number
  image?: string
  product_image?: string
  imei?: string
}

interface BMOrder {
  order_id?: number | string
  state?: number
  date_creation?: string
  date_modification?: string
  expected_dispatch_date?: string
  price?: string | number
  currency?: string
  shipping_address?: BMShippingAddress
  orderlines?: BMOrderLine[]
}

// BackMarket valid API states: 0, 1, 3, 8, 9, 10
// Map BM state numbers to readable order statuses
function mapBMState(state?: number): string {
  switch (state) {
    case 0:  return 'Pending'     // pending
    case 1:  return 'Unshipped'   // new / awaiting validation
    case 3:  return 'Accepted'    // accepted — ready to ship
    case 8:  return 'Refunded'    // refunded
    case 9:  return 'Cancelled'   // cancelled
    case 10: return 'Pending'     // pending payment
    default: return 'Unknown'
  }
}

// ─── US ZIP prefix → state abbreviation ──────────────────────────────────────
// First 3 digits of a US ZIP code map to a state. Covers all USPS prefixes.
const ZIP_PREFIX_TO_STATE: Record<string, string> = {
  '005':'NY','006':'PR','007':'PR','008':'VI','009':'PR',
  '010':'MA','011':'MA','012':'MA','013':'MA','014':'MA','015':'MA','016':'MA','017':'MA','018':'MA','019':'MA',
  '020':'MA','021':'MA','022':'MA','023':'MA','024':'MA','025':'MA','026':'MA','027':'MA',
  '028':'RI','029':'RI',
  '030':'NH','031':'NH','032':'NH','033':'NH','034':'NH','035':'NH','036':'NH','037':'NH','038':'NH',
  '039':'ME','040':'ME','041':'ME','042':'ME','043':'ME','044':'ME','045':'ME','046':'ME','047':'ME','048':'ME','049':'ME',
  '050':'VT','051':'VT','052':'VT','053':'VT','054':'VT','055':'VT','056':'VT','057':'VT','058':'VT','059':'VT',
  '060':'CT','061':'CT','062':'CT','063':'CT','064':'CT','065':'CT','066':'CT','067':'CT','068':'CT','069':'CT',
  '070':'NJ','071':'NJ','072':'NJ','073':'NJ','074':'NJ','075':'NJ','076':'NJ','077':'NJ','078':'NJ','079':'NJ','080':'NJ','081':'NJ','082':'NJ','083':'NJ','084':'NJ','085':'NJ','086':'NJ','087':'NJ','088':'NJ','089':'NJ',
  '090':'AE','091':'AE','092':'AE','093':'AE','094':'AE','095':'AE','096':'AE','097':'AE','098':'AE','099':'AE',
  '100':'NY','101':'NY','102':'NY','103':'NY','104':'NY','105':'NY','106':'NY','107':'NY','108':'NY','109':'NY',
  '110':'NY','111':'NY','112':'NY','113':'NY','114':'NY','115':'NY','116':'NY','117':'NY','118':'NY','119':'NY',
  '120':'NY','121':'NY','122':'NY','123':'NY','124':'NY','125':'NY','126':'NY','127':'NY','128':'NY','129':'NY',
  '130':'NY','131':'NY','132':'NY','133':'NY','134':'NY','135':'NY','136':'NY','137':'NY','138':'NY','139':'NY','140':'NY','141':'NY','142':'NY','143':'NY','144':'NY','145':'NY','146':'NY','147':'NY','148':'NY','149':'NY',
  '150':'PA','151':'PA','152':'PA','153':'PA','154':'PA','155':'PA','156':'PA','157':'PA','158':'PA','159':'PA',
  '160':'PA','161':'PA','162':'PA','163':'PA','164':'PA','165':'PA','166':'PA','167':'PA','168':'PA','169':'PA',
  '170':'PA','171':'PA','172':'PA','173':'PA','174':'PA','175':'PA','176':'PA','177':'PA','178':'PA','179':'PA',
  '180':'PA','181':'PA','182':'PA','183':'PA','184':'PA','185':'PA','186':'PA','187':'PA','188':'PA','189':'PA','190':'PA','191':'PA','192':'PA','193':'PA','194':'PA','195':'PA','196':'PA',
  '197':'DE','198':'DE','199':'DE',
  '200':'DC','201':'VA','202':'DC','203':'DC','204':'DC','205':'DC',
  '206':'MD','207':'MD','208':'MD','209':'MD','210':'MD','211':'MD','212':'MD','214':'MD','215':'MD','216':'MD','217':'MD','218':'MD','219':'MD',
  '220':'VA','221':'VA','222':'VA','223':'VA','224':'VA','225':'VA','226':'VA','227':'VA','228':'VA','229':'VA',
  '230':'VA','231':'VA','232':'VA','233':'VA','234':'VA','235':'VA','236':'VA','237':'VA','238':'VA','239':'VA','240':'VA','241':'VA','242':'VA','243':'VA','244':'VA','245':'VA','246':'WV',
  '247':'WV','248':'WV','249':'WV','250':'WV','251':'WV','252':'WV','253':'WV','254':'WV','255':'WV','256':'WV','257':'WV','258':'WV','259':'WV','260':'WV','261':'WV','262':'WV','263':'WV','264':'WV','265':'WV','266':'WV','267':'WV','268':'WV',
  '270':'NC','271':'NC','272':'NC','273':'NC','274':'NC','275':'NC','276':'NC','277':'NC','278':'NC','279':'NC','280':'NC','281':'NC','282':'NC','283':'NC','284':'NC','285':'NC','286':'NC','287':'NC','288':'NC','289':'NC',
  '290':'SC','291':'SC','292':'SC','293':'SC','294':'SC','295':'SC','296':'SC','297':'SC','298':'SC','299':'SC',
  '300':'GA','301':'GA','302':'GA','303':'GA','304':'GA','305':'GA','306':'GA','307':'GA','308':'GA','309':'GA',
  '310':'GA','311':'GA','312':'GA','313':'GA','314':'GA','315':'GA','316':'GA','317':'GA','318':'GA','319':'GA',
  '320':'FL','321':'FL','322':'FL','323':'FL','324':'FL','325':'FL','326':'FL','327':'FL','328':'FL','329':'FL',
  '330':'FL','331':'FL','332':'FL','333':'FL','334':'FL','335':'FL','336':'FL','337':'FL','338':'FL','339':'FL',
  '340':'AA','341':'FL','342':'FL','344':'FL','346':'FL','347':'FL','349':'FL',
  '350':'AL','351':'AL','352':'AL','353':'AL','354':'AL','355':'AL','356':'AL','357':'AL','358':'AL','359':'AL',
  '360':'AL','361':'AL','362':'AL','363':'AL','364':'AL','365':'AL','366':'AL','367':'AL','368':'AL','369':'AL',
  '370':'TN','371':'TN','372':'TN','373':'TN','374':'TN','375':'TN','376':'TN','377':'TN','378':'TN','379':'TN',
  '380':'TN','381':'TN','382':'TN','383':'TN','384':'TN','385':'MS',
  '386':'MS','387':'MS','388':'MS','389':'MS','390':'MS','391':'MS','392':'MS','393':'MS','394':'MS','395':'MS','396':'MS','397':'MS',
  '398':'GA','399':'GA',
  '400':'KY','401':'KY','402':'KY','403':'KY','404':'KY','405':'KY','406':'KY','407':'KY','408':'KY','409':'KY',
  '410':'KY','411':'KY','412':'KY','413':'KY','414':'KY','415':'KY','416':'KY','417':'KY','418':'KY',
  '420':'KY','421':'KY','422':'KY','423':'KY','424':'KY','425':'KY','426':'KY','427':'KY',
  '430':'OH','431':'OH','432':'OH','433':'OH','434':'OH','435':'OH','436':'OH','437':'OH','438':'OH','439':'OH',
  '440':'OH','441':'OH','442':'OH','443':'OH','444':'OH','445':'OH','446':'OH','447':'OH','448':'OH','449':'OH',
  '450':'OH','451':'OH','452':'OH','453':'OH','454':'OH','455':'OH','456':'OH','457':'OH','458':'OH','459':'OH',
  '460':'IN','461':'IN','462':'IN','463':'IN','464':'IN','465':'IN','466':'IN','467':'IN','468':'IN','469':'IN',
  '470':'IN','471':'IN','472':'IN','473':'IN','474':'IN','475':'IN','476':'IN','477':'IN','478':'IN','479':'IN',
  '480':'MI','481':'MI','482':'MI','483':'MI','484':'MI','485':'MI','486':'MI','487':'MI','488':'MI','489':'MI',
  '490':'MI','491':'MI','492':'MI','493':'MI','494':'MI','495':'MI','496':'MI','497':'MI','498':'MI','499':'MI',
  '500':'IA','501':'IA','502':'IA','503':'IA','504':'IA','505':'IA','506':'IA','507':'IA','508':'IA','509':'IA',
  '510':'IA','511':'IA','512':'IA','513':'IA','514':'IA','515':'IA','516':'IA','520':'IA','521':'IA','522':'IA','523':'IA','524':'IA','525':'IA','526':'IA','527':'IA','528':'IA',
  '530':'WI','531':'WI','532':'WI','534':'WI','535':'WI','537':'WI','538':'WI','539':'WI',
  '540':'MN','541':'MN','542':'MN','543':'MN','544':'MN','545':'MN','546':'MN','547':'MN','548':'MN','549':'MN',
  '550':'MN','551':'MN','553':'MN','554':'MN','555':'MN','556':'MN','557':'MN','558':'MN','559':'MN','560':'MN','561':'MN','562':'MN','563':'MN','564':'MN','565':'MN','566':'MN','567':'MN',
  '570':'SD','571':'SD','572':'SD','573':'SD','574':'SD','575':'SD','576':'SD','577':'SD',
  '580':'ND','581':'ND','582':'ND','583':'ND','584':'ND','585':'ND','586':'ND','587':'ND','588':'ND',
  '590':'MT','591':'MT','592':'MT','593':'MT','594':'MT','595':'MT','596':'MT','597':'MT','598':'MT','599':'MT',
  '600':'IL','601':'IL','602':'IL','603':'IL','604':'IL','605':'IL','606':'IL','607':'IL','608':'IL','609':'IL',
  '610':'IL','611':'IL','612':'IL','613':'IL','614':'IL','615':'IL','616':'IL','617':'IL','618':'IL','619':'IL',
  '620':'IL','621':'IL','622':'IL','623':'IL','624':'IL','625':'IL','626':'IL','627':'IL','628':'IL','629':'IL',
  '630':'MO','631':'MO','633':'MO','634':'MO','635':'MO','636':'MO','637':'MO','638':'MO','639':'MO',
  '640':'KS','641':'MO','644':'MO','645':'MO','646':'MO','647':'MO','648':'MO','649':'MO',
  '650':'KS','651':'KS','652':'KS','653':'KS','654':'KS','655':'KS','656':'KS','657':'KS','658':'KS','659':'KS',
  '660':'KS','661':'KS','662':'KS','664':'KS','665':'KS','666':'KS','667':'KS','668':'KS','669':'KS','670':'KS','671':'KS','672':'KS','673':'KS',
  '680':'NE','681':'NE','683':'NE','684':'NE','685':'NE','686':'NE','687':'NE','688':'NE','689':'NE','690':'NE','691':'NE','692':'NE','693':'NE',
  '700':'LA','701':'LA','703':'LA','704':'LA','705':'LA','706':'LA','707':'LA','708':'LA','710':'LA','711':'LA','712':'LA','713':'LA','714':'LA',
  '716':'AR','717':'AR','718':'AR','719':'AR','720':'AR','721':'AR','722':'AR','723':'AR','724':'AR','725':'AR','726':'AR','727':'AR','728':'AR','729':'AR',
  '730':'OK','731':'OK','733':'TX','734':'OK','735':'OK','736':'OK','737':'TX','738':'OK','739':'OK','740':'OK','741':'OK','743':'OK','744':'OK','745':'OK','746':'OK','747':'OK','748':'OK','749':'OK',
  '750':'TX','751':'TX','752':'TX','753':'TX','754':'TX','755':'TX','756':'TX','757':'TX','758':'TX','759':'TX',
  '760':'TX','761':'TX','762':'TX','763':'TX','764':'TX','765':'TX','766':'TX','767':'TX','768':'TX','769':'TX',
  '770':'TX','771':'TX','772':'TX','773':'TX','774':'TX','775':'TX','776':'TX','777':'TX','778':'TX','779':'TX',
  '780':'TX','781':'TX','782':'TX','783':'TX','784':'TX','785':'TX','786':'TX','787':'TX','788':'TX','789':'TX',
  '790':'TX','791':'TX','792':'TX','793':'TX','794':'TX','795':'TX','796':'TX','797':'TX','798':'TX','799':'TX',
  '800':'CO','801':'CO','802':'CO','803':'CO','804':'CO','805':'CO','806':'CO','807':'CO','808':'CO','809':'CO',
  '810':'CO','811':'CO','812':'CO','813':'CO','814':'CO','815':'CO','816':'CO',
  '820':'WY','821':'WY','822':'WY','823':'WY','824':'WY','825':'WY','826':'WY','827':'WY','828':'WY','829':'WY','830':'WY','831':'WY',
  '832':'ID','833':'ID','834':'ID','835':'ID','836':'ID','837':'ID','838':'ID',
  '840':'UT','841':'UT','842':'UT','843':'UT','844':'UT','845':'UT','846':'UT','847':'UT',
  '850':'AZ','851':'AZ','852':'AZ','853':'AZ','855':'AZ','856':'AZ','857':'AZ','859':'AZ','860':'AZ','863':'AZ','864':'AZ','865':'AZ',
  '870':'NM','871':'NM','872':'NM','873':'NM','874':'NM','875':'NM','877':'NM','878':'NM','879':'NM','880':'TX','881':'TX','882':'NM','883':'NM','884':'NM','885':'TX',
  '889':'NV','890':'NV','891':'NV','893':'NV','894':'NV','895':'NV','897':'NV','898':'NV',
  '900':'CA','901':'CA','902':'CA','903':'CA','904':'CA','905':'CA','906':'CA','907':'CA','908':'CA','909':'CA',
  '910':'CA','911':'CA','912':'CA','913':'CA','914':'CA','915':'CA','916':'CA','917':'CA','918':'CA','919':'CA',
  '920':'CA','921':'CA','922':'CA','923':'CA','924':'CA','925':'CA','926':'CA','927':'CA','928':'CA',
  '930':'CA','931':'CA','932':'CA','933':'CA','934':'CA','935':'CA','936':'CA','937':'CA','938':'CA','939':'CA',
  '940':'CA','941':'CA','942':'CA','943':'CA','944':'CA','945':'CA','946':'CA','947':'CA','948':'CA','949':'CA',
  '950':'CA','951':'CA','952':'CA','953':'CA','954':'CA','955':'CA','956':'CA','957':'CA','958':'CA','959':'CA',
  '960':'CA','961':'CA',
  '967':'HI','968':'HI',
  '970':'OR','971':'OR','972':'OR','973':'OR','974':'OR','975':'OR','976':'OR','977':'OR','978':'OR','979':'OR',
  '980':'WA','981':'WA','982':'WA','983':'WA','984':'WA','985':'WA','986':'WA','988':'WA','989':'WA','990':'WA','991':'WA','992':'WA','993':'WA','994':'WA',
  '995':'AK','996':'AK','997':'AK','998':'AK','999':'AK',
}

function stateFromZip(zip: string | null | undefined): string | null {
  if (!zip) return null
  const prefix = zip.replace(/\D/g, '').slice(0, 3)
  return ZIP_PREFIX_TO_STATE[prefix] ?? null
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function syncBackMarketOrders(
  accountId: string,
  jobId: string,
): Promise<void> {
  console.log(`[SyncBMOrders] Starting sync — accountId=${accountId} jobId=${jobId}`)
  await prisma.orderSyncJob.update({ where: { id: jobId }, data: { status: 'RUNNING' } })

  try {
    // Load active BackMarket credential and decrypt API key
    const credential = await prisma.backMarketCredential.findFirst({
      where: { isActive: true },
      select: { apiKeyEnc: true },
    })
    if (!credential) throw new Error('No active BackMarket credential found')
    const apiKey = decrypt(credential.apiKeyEnc)

    const client = new BackMarketClient(apiKey)

    // Fetch orders with state 1 (new/awaiting validation) and state 3 (accepted/to be shipped)
    console.log('[SyncBMOrders] Fetching state=1 (new) orders…')
    const state1Orders = await client.fetchAllPages<BMOrder>('/orders', { state: 1 })
    console.log(`[SyncBMOrders] Fetched ${state1Orders.length} state=1 orders`)

    console.log('[SyncBMOrders] Fetching state=3 (accepted) orders…')
    const state3Orders = await client.fetchAllPages<BMOrder>('/orders', { state: 3 })
    console.log(`[SyncBMOrders] Fetched ${state3Orders.length} state=3 orders`)

    // Also fetch state 0 (pending) and state 10 (pending payment) to catch
    // orders showing as "To Be Shipped" on BackMarket's website
    console.log('[SyncBMOrders] Fetching state=0 (pending) orders…')
    const state0Orders = await client.fetchAllPages<BMOrder>('/orders', { state: 0 })
    console.log(`[SyncBMOrders] Fetched ${state0Orders.length} state=0 orders`)

    console.log('[SyncBMOrders] Fetching state=10 (pending payment) orders…')
    const state10Orders = await client.fetchAllPages<BMOrder>('/orders', { state: 10 })
    console.log(`[SyncBMOrders] Fetched ${state10Orders.length} state=10 orders`)

    const allOrders = [...state1Orders, ...state3Orders, ...state0Orders, ...state10Orders]
    console.log(`[SyncBMOrders] Total orders fetched: ${allOrders.length}`)
    await prisma.orderSyncJob.update({ where: { id: jobId }, data: { totalFound: allOrders.length } })

    // Pre-load existing BackMarket orders to skip redundant work
    const existingRows = await prisma.order.findMany({
      where: { accountId, orderSource: 'backmarket' },
      select: {
        amazonOrderId: true,
        olmNumber: true,
        orderStatus: true,
        _count: { select: { items: true } },
      },
    })
    const existingMap = new Map(existingRows.map(r => [r.amazonOrderId, r]))
    console.log(`[SyncBMOrders] ${existingMap.size} BM orders already in DB`)

    let synced = 0

    /** Atomically allocate next OLM number. */
    const nextOlmNumber = async (): Promise<number> => {
      const agg = await prisma.order.aggregate({ _max: { olmNumber: true } })
      return (agg._max.olmNumber ?? 999) + 1
    }

    for (let i = 0; i < allOrders.length; i++) {
      const o = allOrders[i]
      const orderId = String(o.order_id ?? '')
      if (!orderId) continue

      const existing = existingMap.get(orderId)
      const isNew = !existing
      const addr = o.shipping_address

      // Log first order's raw address to diagnose field naming
      if (i === 0 && addr) {
        console.log('[SyncBMOrders] Sample shipping_address keys:', JSON.stringify(addr))
      }

      const shipToName = [addr?.first_name, addr?.last_name].filter(Boolean).join(' ') || null
      // BM may send zip under different field names depending on API version
      const addrZip = (addr?.zipcode ?? addr?.postal_code ?? addr?.zip ?? null) as string | null
      const addrState = (addr?.state ?? stateFromZip(addr?.zipcode ?? addr?.postal_code ?? addr?.zip) ?? null) as string | null
      const addrCountry = (addr?.country ?? addr?.country_code ?? null) as string | null

      // Sum orderline_fee from all orderlines for actual commission
      const totalFee = o.orderlines?.reduce((sum, line) => {
        const fee = line.orderline_fee != null ? parseFloat(String(line.orderline_fee)) : 0
        return sum + (isNaN(fee) ? 0 : fee)
      }, 0) ?? 0
      const hasRealCommission = totalFee > 0

      const orderRecord = await (async () => {
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            return await prisma.order.upsert({
              where: {
                accountId_amazonOrderId_orderSource: {
                  accountId,
                  amazonOrderId: orderId,
                  orderSource: 'backmarket',
                },
              },
              create: {
                accountId,
                amazonOrderId: orderId,
                olmNumber: isNew ? await nextOlmNumber() : undefined,
                orderSource: 'backmarket',
                orderStatus: mapBMState(o.state),
                workflowStatus: 'PENDING',
                purchaseDate: new Date(o.date_creation ?? Date.now()),
                lastUpdateDate: new Date(o.date_modification ?? Date.now()),
                orderTotal: o.price != null ? parseFloat(String(o.price)) : null,
                currency: o.currency ?? 'EUR',
                fulfillmentChannel: 'BACKMARKET',
                shipmentServiceLevel: null,
                numberOfItemsUnshipped: o.orderlines?.reduce((sum, l) => sum + (l.quantity ?? 1), 0) ?? 0,
                shipToName,
                shipToAddress1: addr?.street ?? null,
                shipToAddress2: addr?.street2 ?? null,
                shipToCity: addr?.city ?? null,
                shipToState: addrState,
                shipToPostal: addrZip,
                shipToCountry: addrCountry,
                shipToPhone: addr?.phone ?? null,
                isPrime: false,
                latestDeliveryDate: o.expected_dispatch_date ? new Date(o.expected_dispatch_date) : null,
                lastSyncedAt: new Date(),
                ...(hasRealCommission ? {
                  marketplaceCommission: Math.round(totalFee * 100) / 100,
                  commissionSyncedAt: new Date(),
                } : {}),
              },
              update: {
                orderStatus: mapBMState(o.state),
                lastUpdateDate: new Date(o.date_modification ?? Date.now()),
                numberOfItemsUnshipped: o.orderlines?.reduce((sum, l) => sum + (l.quantity ?? 1), 0) ?? 0,
                latestDeliveryDate: o.expected_dispatch_date ? new Date(o.expected_dispatch_date) : undefined,
                lastSyncedAt: new Date(),
                // Only overwrite address fields when BM provides complete data;
                // don't null-out fields that ShipStation may have already backfilled
                ...(addr && addrState && addrZip ? {
                  shipToName,
                  shipToAddress1: addr.street ?? null,
                  shipToAddress2: addr.street2 ?? null,
                  shipToCity: addr.city ?? null,
                  shipToState: addrState,
                  shipToPostal: addrZip,
                  shipToCountry: addrCountry,
                  shipToPhone: addr.phone ?? null,
                } : {}),
                ...(hasRealCommission ? {
                  marketplaceCommission: Math.round(totalFee * 100) / 100,
                  commissionSyncedAt: new Date(),
                } : {}),
              },
            })
          } catch (err) {
            const isOlmConflict = err instanceof Error && err.message.includes('olmNumber')
            if (isOlmConflict && attempt < 2) {
              console.warn(`[SyncBMOrders] OLM conflict for ${orderId}, retrying (attempt ${attempt + 1})`)
              continue
            }
            throw err
          }
        }
        throw new Error('Unreachable')
      })()

      // Upsert order items from orderlines
      if (o.orderlines?.length) {
        for (const line of o.orderlines) {
          const lineId = String(line.id ?? '')
          if (!lineId) continue
          const lineImageUrl = line.image || line.product_image || null
          await prisma.orderItem.upsert({
            where: { orderId_orderItemId: { orderId: orderRecord.id, orderItemId: lineId } },
            create: {
              orderId: orderRecord.id,
              orderItemId: lineId,
              sellerSku: line.listing ?? null,
              title: line.product ?? null,
              quantityOrdered: line.quantity ?? 1,
              quantityShipped: 0,
              itemPrice: line.price != null ? parseFloat(String(line.price)) : null,
              shippingPrice: line.shipping_price != null ? parseFloat(String(line.shipping_price)) : null,
              imageUrl: lineImageUrl,
            },
            update: {
              // NOTE: sellerSku and title intentionally excluded — users may
              // manually edit them via the SKU swap UI and we must not revert.
              quantityOrdered: line.quantity ?? 1,
              itemPrice: line.price != null ? parseFloat(String(line.price)) : null,
              shippingPrice: line.shipping_price != null ? parseFloat(String(line.shipping_price)) : null,
              imageUrl: lineImageUrl,
            },
          })
        }
      }

      synced++
      // Batch progress updates every 5 orders
      if (synced % 5 === 0 || i === allOrders.length - 1) {
        await prisma.orderSyncJob.update({ where: { id: jobId }, data: { totalSynced: synced } })
      }
    }

    // Cleanup: delete PENDING BackMarket orders no longer returned by the API
    const fetchedIds = allOrders.map(o => String(o.order_id ?? '')).filter(Boolean)
    await prisma.order.deleteMany({
      where: {
        accountId,
        orderSource: 'backmarket',
        workflowStatus: 'PENDING',
        amazonOrderId: { notIn: fetchedIds },
      },
    })

    console.log(`[SyncBMOrders] Sync complete — ${synced} orders upserted`)
    await prisma.orderSyncJob.update({
      where: { id: jobId },
      data: { status: 'COMPLETED', completedAt: new Date() },
    })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[SyncBMOrders] Fatal error:', msg)
    try {
      await prisma.orderSyncJob.update({
        where: { id: jobId },
        data: { status: 'FAILED', errorMessage: msg, completedAt: new Date() },
      })
    } catch (dbErr) {
      console.error('[SyncBMOrders] Could not mark job as FAILED:', dbErr)
    }
  }
}
