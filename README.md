# SiteBuild Flow

Hospital Construction ERP Ecosystem 1. Roles & Approval Workflow Supervisor • Executes Site Operations • Creates PR ↓ Uploads Quotations ↓ Uploads PO ↓ Receives Materials ↓ Updates Inventory & Progress ↓ Uploads Invoice & Documents ↓ Tracks Vendor Payments Cannot: Approve Quotations, Payments or POs. Administrator Reviews & Approves Requests (Within Limit) ↓ Manages Vendors ↓ Reports ↓ Finance ↓ Users Cannot: Override Head Admin Rules. A1 Approves Above Admin Limit ↓ Override Project Decisions ↓ Organization Reports. A1+ Final Approval Authority ↓ Full System Control. Approval Limits ₹0–50,000 → Admin ₹50,001–₹5,00,000 → A1 Above ₹5,00,000 → A1+ 2. Core Modules PR ↓ Quotation ↓ Admin ↓ A1 ↓ PO ↓ Material Received ↓ Invoice ↓ Payment ↓ Completed Gate Pass ↓ OTP ↓ QR Scan ↓ Material Exit ↓ Exit Time Material Traceability: Supplier ↓ Batch ↓ Manufacturer ↓ Purchase Date ↓ Invoice ↓ Delivery Challan ↓ MTC ↓ Lab Report ↓ Photos Quality Control: Inspection ↓ Checklist ↓ Test Result ↓ Pass/Fail ↓ Rectification ↓ Re-inspection ↓ Photos Visitor & Vehicle Register Labour Management Document Linking: PR ↓ Quotation ↓ PO ↓ Material Receipt ↓ Invoice ↓ Payment ↓ Gate Pass 3. Timeline, Challenges & ERP Comparison Estimated Timeline (Prototype) Day 1 ↓ Requirements & UI Day 2 ↓ Backend & Database Day 3 ↓ Integration & Workflow Day 4 ↓ Testing & DeliveryHigh Severity Challenges • RBAC (Role-Based Access Control) • OTP Authentication & QR Validation • Strong Immutable

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/42074104-7877-408e-bf76-665291672086).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
