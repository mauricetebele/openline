# OpenLine — Employee Instruction Manual

---

## Table of Contents

1. [Getting Started](#1-getting-started)
2. [Order Management](#2-order-management)
3. [Inventory & Warehouse](#3-inventory--warehouse)
4. [Purchase Orders & Receiving](#4-purchase-orders--receiving)
5. [Shipping & Labels](#5-shipping--labels)
6. [Serial Number Tracking](#6-serial-number-tracking)
7. [Products & SKUs](#7-products--skus)
8. [Marketplace Listings](#8-marketplace-listings)
9. [Refund Auditing](#9-refund-auditing)
10. [Returns & RMA](#10-returns--rma)
11. [Wholesale](#11-wholesale)
12. [Settings & Configuration](#12-settings--configuration)
13. [Appendix: Order Workflow Diagram](#13-appendix-order-workflow-diagram)

---

## 1. Getting Started

### Logging In

- Navigate to the site URL and sign in with your email and password.
- Your admin will have created your account and assigned you a role (**Admin** or **Reviewer**).

### Navigation

- The **sidebar** on the left lists all major sections: Orders, Inventory, Products, Listings, Refunds, Wholesale, Returns, and Settings.
- The **top bar** has a quick order search — type an Amazon Order ID or OLM number to jump directly to any order.

---

## 2. Order Management

### Where Orders Come From

Orders sync automatically from three sources:

| Source | How It Syncs |
|--------|-------------|
| **Amazon (MFN)** | Auto-synced every 15 minutes via cron job |
| **Back Market** | Auto-synced every 15 minutes via cron job |
| **Wholesale** | Created manually in the Wholesale module |

### Order Workflow

Every order moves through these statuses:

```
PENDING → PROCESSING → AWAITING VERIFICATION → SHIPPED
                                                  ↕
                                              CANCELLED
```

**PENDING** — The order just came in. No inventory is reserved yet.

**PROCESSING** — You (or the system) moved the order to processing. Inventory is now reserved from the warehouse so other orders can't claim it.

**AWAITING VERIFICATION** — A shipping label has been purchased. The order needs serial numbers assigned (if applicable) and a final check before shipping.

**SHIPPED** — The order is done. Tracking is live, serials are marked as SOLD, and a PAID stamp appears on marketplace invoices.

**CANCELLED** — The order was cancelled. All reserved inventory is released back to stock.

### Unshipped Orders Page

This is your main workspace for fulfilling orders. It has tabs for each workflow status.

**Processing an order:**

1. Go to **Unshipped Orders**.
2. On the **Pending** tab, find the order you want to process.
3. Click the **Process** button. This reserves inventory from the warehouse.
4. The order moves to the **Unshipped** tab.

**Buying a shipping label:**

1. On the **Unshipped** tab, select the order.
2. A shipping preset (carrier + service + weight) should be applied. If not, apply one.
3. Click **Buy Label**. The system purchases the label through ShipStation.
4. The order moves to **Awaiting Verification**.

**Serializing and shipping:**

1. On the **Awaiting Verification** tab, assign serial numbers to each item (if the product is serializable).
2. Verify everything looks correct — serials, tracking, item count.
3. Click **Ship**. The order is marked as shipped, serials become SOLD, and tracking is pushed to the marketplace.

**Cancelling an order:**

1. Click the **Cancel** button on any order.
2. All reserved inventory is released back to stock.
3. The order moves to the **Cancelled** tab.
4. You can **Reinstate** a cancelled order if it was cancelled by mistake.

### Order Detail View

Click any order to see its full details:

- **Order Info** — dates, channel, order number, OLM number
- **Addresses** — billing and shipping
- **Items** — SKUs, quantities, prices
- **Serials** — which specific units were assigned
- **Shipping** — carrier, tracking number, label cost
- **Returns** — any marketplace RMAs linked to this order

You can also **Print Invoice** from here. The PDF invoice opens in a new browser tab.

### Invoices

- Invoices are generated as PDF and open in a new tab.
- **Marketplace orders** (Amazon, Back Market) get a **PAID** rubber stamp.
- **Wholesale orders** can show a **Customer PO #** if one is set.
- **Shipped orders** show the ship date and time.
- Invoice colors (header, accents) are customizable in Settings → Store Settings.

---

## 3. Inventory & Warehouse

### Warehouse Structure

```
Warehouse (e.g., "Main Warehouse")
  └── Location (e.g., "Shelf A", "Receiving", "Finished Goods")
       └── Inventory Items (product + grade → quantity)
            └── Individual Serials (tracked units)
```

- Each **warehouse** has multiple **locations**.
- Locations can be marked as **Finished Goods** — meaning items there are ready to ship.
- Inventory is tracked by **product**, **location**, and **grade** (condition).

### Viewing Inventory

Go to **Inventory** to see all stock. You can filter by:

- Warehouse / Location
- Product / SKU
- Grade (A, B, Refurb, etc.)
- Serial number search

### Inventory Operations

**Adding inventory manually:**

1. Go to **Inventory → Add**.
2. Select the product, grade, and destination location.
3. Enter the serial number(s).
4. Click **Add**. The serial is created with status IN_STOCK.

**Moving inventory between locations:**

1. Go to **Inventory → Move**.
2. Search for the serial number.
3. Select the new destination location.
4. Click **Move**. A LOCATION_MOVE event is recorded in the serial's history.

**Converting a serial to a different SKU:**

1. Go to **Inventory → Convert SKU**.
2. Search for the serial number.
3. Select the new product/SKU.
4. Click **Convert**. A SKU_CONVERSION event is logged.

**Regrading a serial:**

- From the inventory view, you can change a serial's grade (e.g., from "A" to "B") if inspection reveals a different condition.

### Inventory Events Log

Go to **Inventory → Events** to see a full audit trail of every inventory movement. Each event records:

- What happened (receipt, move, sale, return, etc.)
- Which serial
- Who did it
- When
- Source and destination

---

## 4. Purchase Orders & Receiving

### Creating a Purchase Order

1. Go to **Purchase Orders**.
2. Click **New PO**.
3. Select the **vendor**.
4. Add line items: choose the product, quantity, and cost per unit.
5. Save the PO.

### Receiving a PO

When stock arrives from a vendor:

1. Open the PO.
2. Click **Receive**.
3. For each line item, enter:
   - **Serial numbers** (one per unit, if the product is serializable)
   - **Destination location** in the warehouse
   - **Grade** (condition: A, B, Refurb, etc.)
4. Click **Save Receipt**.

Each received serial gets a PO_RECEIPT event in its history, creating a full chain of custody from vendor to warehouse.

### PO Statuses

| Status | Meaning |
|--------|---------|
| **OPEN** | PO created, awaiting delivery |
| **RECEIVED** | All items received |
| **CANCELLED** | PO cancelled |

---

## 5. Shipping & Labels

### Shipping Presets

Shipping presets are saved configurations for quickly buying labels:

- **Carrier** (e.g., UPS, USPS, FedEx)
- **Service** (e.g., UPS Ground, Priority Mail)
- **Weight and dimensions**

Set these up in **Settings → Shipping Presets**. When processing orders, apply a preset to instantly get a rate and buy a label.

### Package Presets

Package presets store just the **weight and dimensions** (no carrier). Use these for **rate shopping** — the system compares prices across all carriers to find the cheapest option.

### Buying Labels

1. On the **Unshipped** tab, apply a shipping preset to the order.
2. Click **Buy Label**.
3. The label is purchased through ShipStation and saved to the order.
4. You can print the label directly.

### Voiding Labels

If you made a mistake:

1. Click **Void Label** on the order.
2. The label is voided in ShipStation.
3. The order moves back to the **Unshipped** tab.
4. Inventory reservations remain — you can buy a new label.

### Return Labels

To generate a return label for a customer:

1. Go to **Return Label**.
2. Enter the Amazon Order ID to look up the customer's address.
3. Select shipping options.
4. Click **Create Return Label**.
5. The UPS return label is generated and can be sent to the customer.

---

## 6. Serial Number Tracking

### Serial Statuses

| Status | Meaning |
|--------|---------|
| **IN_STOCK** | Available in warehouse, ready to sell |
| **SOLD** | Assigned to an order that has shipped |
| **RETURNED** | Came back from a customer |
| **DAMAGED** | Damaged, not available for sale |

### Looking Up a Serial

1. Go to **Inventory → Serial Lookup**.
2. Enter the serial number.
3. You'll see:
   - Current status and location
   - Product and grade
   - Full event history (every move, sale, return, etc.)

### Serial History Events

Every action on a serial is permanently recorded:

| Event | What Happened |
|-------|--------------|
| **PO_RECEIPT** | Received from a vendor via Purchase Order |
| **MANUAL_ADD** | Manually added to inventory |
| **LOCATION_MOVE** | Moved between warehouse locations |
| **SKU_CONVERSION** | Reassigned to a different SKU |
| **ASSIGNED** | Assigned to a customer order |
| **SALE** | Order shipped — serial is now SOLD |
| **UNASSIGNED** | Removed from an order |
| **VOID_REINSTATE** | Label voided or order reinstated |
| **MP_RMA_RETURN** | Received back via marketplace return |
| **NOTE_ADDED** | A note was added to the serial |
| **MANUAL_REMOVE** | Manually removed from inventory |

### Adding Notes to Serials

You can add a note to any serial (e.g., "Scratched screen" or "Missing charger"). Notes are logged as NOTE_ADDED events in the serial history.

---

## 7. Products & SKUs

### Product Catalog

Go to **Products** to manage your product catalog.

Each product has:

- **SKU** — your internal identifier
- **Name / Description**
- **Serializable** flag — whether individual units are tracked by serial number
- **Grades** — condition tiers (e.g., A, B, Refurb)

### Product Grades

Grades represent the condition of a product. Common grades:

- **A** — Like new, excellent condition
- **B** — Good condition, minor cosmetic wear
- **Refurb** — Refurbished

Each grade can be mapped to different marketplace SKUs (so "Grade A" sells under one listing and "Grade B" under another).

### Marketplace SKU Mapping

Go to **Marketplace SKUs** to connect your internal products to marketplace listings.

Each mapping connects:

- **Seller SKU** (what Amazon/Back Market sees)
- **Product + Grade** (your internal tracking)
- **syncQty** flag — if ON, the system auto-pushes available quantity to that listing

---

## 8. Marketplace Listings

### Active Listings

Go to **Active Listings** to see all your Amazon listings. From here you can:

- **Update prices** inline
- **View competitive offers** (what other sellers are charging)
- **Assign listing groups** for bulk management

### Shipping Templates

Go to **Shipping Templates** to manage which shipping template is assigned to each listing. You can bulk-update templates across many listings at once.

### Pricing Rules

Go to **Pricing Rules** to see min/max price limits and fulfillment type for each listing.

### Quantity Push

The system automatically pushes inventory quantities to marketplaces every 10 minutes (for SKUs with `syncQty` enabled).

**How quantity is calculated:**

```
Available Qty = SUM(in-stock inventory) − SUM(Amazon Pending MFN orders)
```

This ensures that pending orders don't cause overselling.

---

## 9. Refund Auditing

### What It Does

The system imports refunds from Amazon automatically and lets you review them to catch invalid refunds (wrong item returned, item never received, etc.).

### Reviewing Refunds

1. Go to **Refunds**.
2. Filter by date range, fulfillment type (FBA/MFN), or status.
3. Click on a refund to see the full details (items, amounts, reason).
4. Mark as **Valid** or **Invalid**.

### Invalid Refund Reasons

When marking a refund as invalid, select a reason:

- Different item returned
- Return never received
- Outside policy window
- Wrong SKU/ASIN mismatch
- Duplicate refund
- Shipping not returned
- Chargeback related
- Other (custom reason)

### Bulk Review

Select multiple refunds and mark them all as Valid or Invalid at once using the bulk action buttons.

### Audit Trail

Every review decision is logged with who made it and when. Go to **Audit Log** to see the full history, searchable and exportable as CSV.

---

## 10. Returns & RMA

### Marketplace Returns (Customer → You)

When a customer returns an item from Amazon or Back Market:

1. Go to **Marketplace Returns**.
2. Search for the original order.
3. Click **Create RMA**.
4. When the item arrives, click **Receive**:
   - Enter the serial number of the returned unit
   - Select a **grade** (condition after inspection)
   - Choose a **warehouse location** to store it
   - Add any notes (damage, missing accessories, etc.)
5. The serial gets an MP_RMA_RETURN event and goes back to IN_STOCK at the selected location.

### MFN Returns

Go to **MFN Returns** to see Amazon Merchant Fulfilled returns:

- These are synced from Amazon's flat-file reports.
- You can see the return reason, Amazon RMA number, and live carrier tracking status.
- Track which returns are delivered, in transit, or pending.

### Vendor RMA (You → Vendor)

When you need to return defective stock to a vendor:

1. Go to **Vendor RMA**.
2. Click **New RMA** and select the vendor.
3. Add the items/serials you're returning.
4. The RMA moves through these statuses:

```
AWAITING VENDOR APPROVAL → APPROVED TO RETURN → SHIPPED (AWAITING CREDIT) → CREDIT RECEIVED
```

5. Track the vendor's approval number, your shipping carrier/tracking, and the credit amount.

### Wholesale Customer RMA (Customer → You)

For B2B customers returning goods:

1. Go to **Wholesale → Customer RMA**.
2. Create an RMA for the customer.
3. When items arrive, receive and inspect them.
4. Mark as **Refunded** or **Rejected**.

---

## 11. Wholesale

### Overview

The wholesale module handles B2B sales — selling in bulk to other businesses.

### Managing Customers

Go to **Wholesale → Customers** to:

- Create customer accounts
- Set **payment terms** (NET 15, NET 30, NET 60, NET 90)
- Set **credit limits**
- Configure **tax settings**
- Manage shipping/billing addresses

### Creating a Wholesale Order

1. Go to **Wholesale → Orders → New Order**.
2. Select the customer.
3. Add line items (products, quantities, prices).
4. Save the order.

### Wholesale Order Workflow

```
DRAFT → CONFIRMED → PROCESSING → SHIPPED → DELIVERED
```

- **Process** the order to reserve inventory.
- **Ship** the order to mark it as fulfilled with tracking info.

### Payments & Aging

- Go to **Wholesale → Orders** to record customer payments.
- Payments are allocated against specific orders.
- Go to **Wholesale → Aging** to see an aged receivables report — which customers owe money and how overdue they are.

---

## 12. Settings & Configuration

### Store Settings

Go to **Settings → Store Settings** to configure:

- **Store name** and **logo** (appears on invoices)
- **Contact info** — phone, email, address
- **Thank you message** — printed at the bottom of invoices
- **Invoice colors** — pick a primary color (headers, totals) and accent color (thank-you text) using the color pickers

### Amazon Accounts

- Connect multiple Amazon seller accounts via OAuth.
- Each account stores encrypted API tokens.
- Orders and refunds are synced per account.

### ShipStation

- Configure ShipStation API keys (V1 and V2).
- Test carrier connections.
- View available carriers and services.

### UPS

- Enter UPS OAuth credentials for return label generation.

### Back Market

- Enter your Back Market API key for order syncing.

### Warehouses

- Create warehouses and their storage locations.
- Mark locations as **Finished Goods** (ready-to-ship stock lives here).

### Shipping Presets

- Create named presets (carrier + service + weight) for quick label purchases.

### Package Presets

- Create weight/dimension templates for rate shopping across carriers.

### RMA Settings

- Manage the list of return reasons available when creating marketplace RMAs.

---

## 13. Appendix: Order Workflow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     ORDER LIFECYCLE                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   Amazon / Back Market / Wholesale                          │
│           │                                                 │
│           ▼                                                 │
│      ┌─────────┐                                            │
│      │ PENDING │  ← Order synced, no inventory reserved     │
│      └────┬────┘                                            │
│           │  [Process Order]                                │
│           ▼                                                 │
│    ┌────────────┐                                           │
│    │ PROCESSING │  ← Inventory reserved from warehouse      │
│    └─────┬──────┘                                           │
│          │  [Buy Shipping Label]                            │
│          ▼                                                  │
│  ┌───────────────────────┐                                  │
│  │ AWAITING VERIFICATION │  ← Label purchased, verify items │
│  └──────────┬────────────┘                                  │
│             │  [Assign Serials + Ship]                      │
│             ▼                                               │
│       ┌─────────┐                                           │
│       │ SHIPPED │  ← Done! Serials marked SOLD              │
│       └─────────┘                                           │
│                                                             │
│   At any point before shipping:                             │
│   [Cancel] → CANCELLED (inventory released)                 │
│   [Reinstate] → Back to previous status                     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Quick Reference: Common Daily Tasks

| Task | Where to Go |
|------|------------|
| Process new orders | Unshipped Orders → Pending tab |
| Buy shipping labels | Unshipped Orders → Unshipped tab |
| Verify and ship | Unshipped Orders → Awaiting tab |
| Receive a PO | Purchase Orders → Open PO → Receive |
| Look up a serial | Inventory → Serial Lookup |
| Move stock | Inventory → Move |
| Review refunds | Refunds |
| Handle a return | Marketplace Returns |
| Create wholesale order | Wholesale → Orders → New |
| Print an invoice | Order Detail → Print Invoice |
| Change invoice colors | Settings → Store Settings |

---

*Last updated: March 2026*
