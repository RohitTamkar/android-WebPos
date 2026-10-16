import express from "express";
import { updateOutletProduct } from "./productUpdate.js";
import { updateCategoryNames, CategoryUpdateError } from "./categoryUpdate.js";
import { deleteOutletRecord, OutletDeletionError } from "./outletDeletion.js";
import { createOutletProduct, requireProductOutlet, productTaxes, PRODUCT_UNITS, ProductCreationError } from "./productCreation.js";
import type { Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import jwt from "jsonwebtoken";
import type { JwtPayload } from "jsonwebtoken";
import { z } from "zod";
import { getFirebaseApp, getFirestoreDb, verifyFirebaseConnection } from "./firebase.js";
import { summarizeDay } from "./daywiseSummary.js";
import { stockDirection, stockMovementRecord } from "./stockMovementReport.js";
import { isStockTransfer, stockTransferRecord } from "./stockTransferReport.js";
import { checkAuthorizedProductImport, persistProductImport, nextProductCode, PRODUCT_IMPORT_WRITES_ENABLED } from "./productImportValidation.js";
import { createProductImportChunk } from "./productImportWriter.js";
import { createInMemoryProductImportQuota, ProductImportQuotaError } from "./productImportQuota.js";

dotenv.config({ path: fileURLToPath(new URL("../.env", import.meta.url)) });

const app = express();
const PORT = process.env.PORT || 3000;
// Temporary per-process restriction only; restart/multiple instances reset/isolate it.
const productImportQuota = createInMemoryProductImportQuota();
const JWT_SECRET = process.env.JWT_SECRET || "web-pos-secret-key-2026";

app.use(cors());
app.use("/api/outlets/:outletId/products/import", express.json({ limit: "12mb" }));
app.use(express.json());

// In-memory Category Store
interface CategoryItem {
  id: string;
  code: string;
  name: string;
  description: string;
  status: "Active" | "Inactive";
  productCount: number;
  color: string;
  createdAt: string;
}

let categories: CategoryItem[] = [
  {
    id: "cat_1",
    code: "CAT-001",
    name: "Beverages & Drinks",
    description: "Cold drinks, juices, soda, mineral water, coffee, and tea",
    status: "Active",
    productCount: 28,
    color: "#3567f0",
    createdAt: "2024-01-15"
  },
  {
    id: "cat_2",
    code: "CAT-002",
    name: "Bakery & Breads",
    description: "Fresh sliced bread, cookies, croissants, and pastries",
    status: "Active",
    productCount: 19,
    color: "#d88900",
    createdAt: "2024-01-18"
  },
  {
    id: "cat_3",
    code: "CAT-003",
    name: "Snacks & Munchies",
    description: "Potato chips, roasted namkeen, popcorn, and quick bites",
    status: "Active",
    productCount: 42,
    color: "#ff343d",
    createdAt: "2024-01-22"
  },
  {
    id: "cat_4",
    code: "CAT-004",
    name: "Dairy & Eggs",
    description: "Full cream milk, butter, curd, paneer, and eggs",
    status: "Active",
    productCount: 14,
    color: "#11bcc3",
    createdAt: "2024-02-01"
  }
];

// Health check endpoint
app.get("/api/health", (_req: Request, res: Response) => {
  let firebase: { initialized: boolean; projectId?: string; message?: string };
  try {
    const firebaseApp = getFirebaseApp();
    firebase = { initialized: true, projectId: firebaseApp.options.projectId ?? "" };
  } catch {
    firebase = {
      initialized: false,
      message: "Configure valid Firebase credentials and testing project isolation on the server"
    };
  }
  res.json({
    success: true,
    message: "Web POS API is running",
    firebase,
    timestamp: new Date().toISOString()
  });
});

// Verifies credentials and makes a real request to Cloud Firestore.
app.get("/api/firebase/health", async (_req: Request, res: Response): Promise<void> => {
  try {
    await verifyFirebaseConnection();
    res.json({
      success: true,
      message: "Firebase is connected",
      projectId: getFirebaseApp().options.projectId
    });
  } catch (error) {
    console.error("Firebase connection check failed:", error);
    res.status(503).json({
      success: false,
      message: "Firebase connection failed"
    });
  }
});

const loginSchema = z.object({
  email: z.string().trim().email(),
  quickPin: z.string().trim().regex(/^\d{4,6}$/),
  terminal: z.string().trim().max(100).optional()
});

interface PosTokenPayload extends JwtPayload {
  userId: string;
  profileDocId: string;
  email: string;
  name: string;
  role: string;
  terminal: string;
}

function profileRole(value: unknown): string {
  const role = typeof value === "string" ? value.trim() : "";
  if (!role) return "User";

  return role
    .toLowerCase()
    .replace(/\b\w/g, character => character.toUpperCase());
}

// Authenticates an active USER_PROFILE using its email and quickPin fields.
app.post("/api/auth/login", async (req: Request, res: Response): Promise<void> => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      message: "Enter a valid email address and a 4 to 6 digit quick PIN"
    });
    return;
  }

  const { email, quickPin, terminal = "POS Workspace" } = parsed.data;

  try {
    getFirebaseApp();
  } catch (error) {
    console.error("Firebase configuration error:", error);
    res.status(503).json({
      success: false,
      message: "Firebase credentials or testing isolation are missing or invalid. Check the server configuration."
    });
    return;
  }

  try {
    const snapshot = await getFirestoreDb()
      .collection("USER_PROFILE")
      .where("email", "==", email.toLowerCase())
      .get();

    const document = snapshot.docs.find(
      candidate => String(candidate.data().quickPin ?? "") === quickPin
    );
    const profile = document?.data();

    if (!document || !profile) {
      res.status(401).json({
        success: false,
        message: "Invalid email or quick PIN"
      });
      return;
    }

    if (profile.active !== true) {
      res.status(403).json({
        success: false,
        message: "This user account is inactive"
      });
      return;
    }

    const userId = typeof profile.id === "string" && profile.id ? profile.id : document.id;
    const name = typeof profile.name === "string" && profile.name ? profile.name : email;
    const role = profileRole(profile.roll);
    const token = jwt.sign(
      { userId, profileDocId: document.id, email, name, role, terminal },
      JWT_SECRET,
      { expiresIn: "12h" }
    );

    res.json({
      success: true,
      message: `Authentication successful for ${name}`,
      data: {
        token,
        user: { id: userId, email, name, role, terminal }
      }
    });
  } catch (error) {
    console.error("Firestore login failed:", error);
    res.status(503).json({
      success: false,
      message: "Login service is temporarily unavailable"
    });
  }
});

function readAccessToken(req: Request): PosTokenPayload | null {
  const authorization = req.header("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;

  try {
    const payload = jwt.verify(authorization.slice(7), JWT_SECRET);
    if (typeof payload === "string" || typeof payload.profileDocId !== "string") return null;
    return payload as PosTokenPayload;
  } catch {
    return null;
  }
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

// Display metadata only: retain the historical rate without recalculating sales.
function historicalReportTaxRate(bill: Record<string, unknown>, item: Record<string, unknown>): number | null {
  if ((stringValue(bill.taxType) || "NoTax").toLowerCase() === "notax") return 0;
  const rate = item.taxPercentage;
  return typeof rate === "number" && Number.isFinite(rate) && rate >= 0 ? rate : null;
}

function reportTaxRateLabel(rates: Set<number | null>): string | number {
  const known = [...rates].filter((rate): rate is number => rate !== null);
  if (known.length > 1) return known.sort((a, b) => a - b).map(rate => `${rate}%`).join(", ");
  if (rates.has(null) || known.length === 0) return 0;
  return `${known[0]}%`;
}

interface ReportTaxGroup {
  rate: number | null;
  quantity: number;
  amount: number;
  taxableValue: number;
  taxAmount: number;
  products: Set<string>;
}

function addReportTaxGroup(
  groups: Map<number | null, ReportTaxGroup>, bill: Record<string, unknown>,
  item: Record<string, unknown>, productId: string,
): void {
  const rate = historicalReportTaxRate(bill, item);
  const lineTotal = numberValue(item.total);
  const taxType = (stringValue(bill.taxType) || "NoTax").toLowerCase();
  // Identical item-level formula to the existing GST report. Sale stays item.total.
  const taxAmount = rate === null || rate <= 0 ? 0
    : taxType === "inclusive" ? lineTotal - lineTotal / (1 + rate / 100)
    : lineTotal * rate / 100;
  const group = groups.get(rate) ?? {
    rate, quantity: 0, amount: 0, taxableValue: 0, taxAmount: 0, products: new Set<string>(),
  };
  group.quantity += numberValue(item.quantity);
  group.amount += lineTotal;
  group.taxAmount += taxAmount;
  group.taxableValue += taxType === "inclusive" ? lineTotal - taxAmount : lineTotal;
  group.products.add(productId);
  groups.set(rate, group);
}

function reportTaxBreakdown(groups: Map<number | null, ReportTaxGroup>) {
  return [...groups.values()].sort((a, b) => (a.rate ?? Infinity) - (b.rate ?? Infinity))
    .map(({ products, ...group }) => ({ ...group, productCount: products.size }));
}

function reportTaxAmount(groups: Map<number | null, ReportTaxGroup>): number {
  return [...groups.values()].reduce((sum, group) => sum + group.taxAmount, 0);
}

function assignedOutletIds(profile: Record<string, unknown>): string[] {
  const assignedIds = [
    ...(Array.isArray(profile.outlets) ? profile.outlets : []),
    ...(Array.isArray(profile.outletList) ? profile.outletList : []),
    profile.outletId
  ].filter((value): value is string => typeof value === "string" && value.length > 0);

  return [...new Set(assignedIds)];
}

// Returns only OUTLET documents assigned to the authenticated USER_PROFILE.
app.get("/api/auth/outlets", async (req: Request, res: Response): Promise<void> => {
  const token = readAccessToken(req);
  if (!token) {
    res.status(401).json({ success: false, message: "Your session has expired. Please sign in again." });
    return;
  }

  try {
    const db = getFirestoreDb();
    const profileDocument = await db.collection("USER_PROFILE").doc(token.profileDocId).get();
    const profile = profileDocument.data();

    if (!profileDocument.exists || !profile || profile.active !== true) {
      res.status(403).json({ success: false, message: "This user account is inactive or unavailable" });
      return;
    }

    const outletIds = assignedOutletIds(profile);

    if (outletIds.length === 0) {
      res.json({ success: true, data: { primaryOutletId: null, outlets: [] } });
      return;
    }

    const documents = await db.getAll(
      ...outletIds.map(outletId => db.collection("OUTLET").doc(outletId))
    );
    const outlets = documents
      .filter(document => document.exists)
      .map(document => {
        const outlet = document.data() ?? {};
        return {
          id: document.id,
          name: stringValue(outlet.name) || "Unnamed outlet",
          branch: stringValue(outlet.branch),
          country: stringValue(outlet.country),
          dealerCode: stringValue(outlet.dealerCode),
          fssaiNo: stringValue(outlet.fssaiNo),
          businessId: stringValue(outlet.businessId),
          restaurantId: stringValue(outlet.restaurant_id),
          active: outlet.active === true,
          renewalDate: typeof outlet.renewalDate === "number" ? outlet.renewalDate : null,
          isPrimary: document.id === profile.outletId
        };
      })
      .sort((left, right) => Number(right.isPrimary) - Number(left.isPrimary));

    res.json({
      success: true,
      data: {
        primaryOutletId: stringValue(profile.outletId) || null,
        outlets
      }
    });
  } catch (error) {
    console.error("Loading user outlets failed:", error);
    res.status(503).json({ success: false, message: "Unable to load outlets right now" });
  }
});

// Loads the selected outlet's shift summary for the requested business day.
app.get("/api/outlets/:outletId/dashboard", async (req: Request, res: Response): Promise<void> => {
  const token = readAccessToken(req);
  if (!token) {
    res.status(401).json({ success: false, message: "Your session has expired. Please sign in again." });
    return;
  }

  const outletParam = req.params.outletId;
  const outletId = Array.isArray(outletParam) ? outletParam[0] : outletParam;
  const requestedDay = typeof req.query.dayId === "string" ? req.query.dayId : "";
  if (!outletId || !/^\d{4}-\d{2}-\d{2}$/.test(requestedDay)) {
    res.status(400).json({ success: false, message: "A valid outlet and day are required" });
    return;
  }

  try {
    const db = getFirestoreDb();
    const profileDocument = await db.collection("USER_PROFILE").doc(token.profileDocId).get();
    const profile = profileDocument.data();
    if (!profileDocument.exists || !profile || profile.active !== true) {
      res.status(403).json({ success: false, message: "This user account is inactive or unavailable" });
      return;
    }

    if (!assignedOutletIds(profile).includes(outletId)) {
      res.status(403).json({ success: false, message: "You do not have access to this outlet" });
      return;
    }

    const shiftSnapshot = await db
      .collection("OUTLET")
      .doc(outletId)
      .collection("SHIFT")
      .where("dayId", "==", requestedDay)
      .get();

    const shiftDocument = [...shiftSnapshot.docs].sort(
      (left, right) => numberValue(right.data().shiftNo) - numberValue(left.data().shiftNo)
    )[0];

    if (!shiftDocument) {
      res.status(404).json({ success: false, message: `No shift data found for ${requestedDay}` });
      return;
    }

    const shift = req.query.scope === "day"
      ? summarizeDay(shiftSnapshot.docs.map(document => document.data()))
      : shiftDocument.data();
    let payments: Record<string, number> = {};
    if (typeof shift.paymentJson === "string") {
      try {
        const parsed = JSON.parse(shift.paymentJson) as Record<string, unknown>;
        payments = Object.fromEntries(
          Object.entries(parsed).map(([key, value]) => [key, numberValue(value)])
        );
      } catch {
        payments = {};
      }
    }

    res.json({
      success: true,
      data: {
        id: shiftDocument.id,
        dayId: stringValue(shift.dayId),
        shiftNo: numberValue(shift.shiftNo),
        inActive: shift.inActive === true,
        startTime: numberValue(shift.startTime),
        endTime: numberValue(shift.endTime),
        startBillNo: stringValue(shift.startBillNo),
        lastBillNo: stringValue(shift.lastBillNo),
        lastBillTime: numberValue(shift.lastBillTime),
        billCount: numberValue(shift.billCount),
        billDeletesNumber: numberValue(shift.billDeletesNumber),
        billDeletesAmount: numberValue(shift.billDeletesAmount),
        openingAmt: numberValue(shift.openingAmt),
        totalSale: numberValue(shift.totalSale),
        cashSale: numberValue(shift.cashSale),
        digitalSale: numberValue(shift.digitalSale),
        creditSale: numberValue(shift.creditSale),
        subTotalBill: numberValue(shift.subTotalBill),
        discount: numberValue(shift.discount),
        tax: numberValue(shift.tax),
        gstTotal: numberValue(shift.gstTotal),
        vatTotal: numberValue(shift.vatTotal),
        refundAmount: numberValue(shift.refundAmount),
        extraCharges: numberValue(shift.extraCharges),
        serviceChargeAmount: numberValue(shift.serviceChargeAmount),
        roundOff: numberValue(shift.roundOff),
        expensesAmtTotal: numberValue(shift.expensesAmtTotal),
        expCash: numberValue(shift.expCash),
        expDigital: numberValue(shift.expDigital),
        advanceAmtTotal: numberValue(shift.advanceAmtTotal),
        customerReceiveAmtTotal: numberValue(shift.customerReceiveAmtTotal),
        receiveAmtTotal: numberValue(shift.receiveAmtTotal),
        swiggyTotal: numberValue(shift.swiggyTotal),
        zomatoTotal: numberValue(shift.zomatoTotal),
        payments
      }
    });
  } catch (error) {
    console.error("Loading outlet dashboard failed:", error);
    res.status(503).json({ success: false, message: "Unable to load shift data right now" });
  }
});

function datesBetween(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);

  while (cursor <= end && dates.length < 31) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dates;
}

function parsePayment(value: unknown): Record<string, number> {
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed).map(([key, amount]) => [key, numberValue(amount)]));
  } catch {
    return {};
  }
}

// Read-only goods transactions explicitly marked as stock transfers, scoped to an assigned outlet.
app.get("/api/outlets/:outletId/reports/stock-transfers", async (req: Request, res: Response): Promise<void> => {
  const token = readAccessToken(req);
  if (!token) {
    res.status(401).json({ success: false, message: "Your session has expired. Please sign in again." });
    return;
  }
  const outletParam = req.params.outletId;
  const outletId = Array.isArray(outletParam) ? outletParam[0] : outletParam;
  const startDate = typeof req.query.startDate === "string" ? req.query.startDate : "";
  const endDate = typeof req.query.endDate === "string" ? req.query.endDate : startDate;
  const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if (!outletId || !validDate(startDate) || !validDate(endDate) || startDate > endDate) {
    res.status(400).json({ success: false, message: "A valid date range and outlet are required" });
    return;
  }
  const days = datesBetween(startDate, endDate);
  if (days.at(-1) !== endDate) {
    res.status(400).json({ success: false, message: "Date range cannot exceed 31 days" });
    return;
  }
  const search = typeof req.query.search === "string" ? req.query.search.trim().toLowerCase() : "";
  try {
    const db = getFirestoreDb();
    const profileDocument = await db.collection("USER_PROFILE").doc(token.profileDocId).get();
    const profile = profileDocument.data();
    if (!profileDocument.exists || !profile || profile.active !== true) {
      res.status(403).json({ success: false, message: "This user account is inactive or unavailable" });
      return;
    }
    if (!assignedOutletIds(profile).includes(outletId)) {
      res.status(403).json({ success: false, message: "You do not have access to this outlet" });
      return;
    }
    const goods = db.collection("OUTLET").doc(outletId).collection("GOODS_RECEIVED");
    const snapshots = await Promise.all(days.map(day => goods.where("dayID", "==", day).get()));
    const transfers = snapshots.flatMap(snapshot => snapshot.docs)
      .filter(document => isStockTransfer(document.data()))
      .map(document => stockTransferRecord(document.id, document.data()))
      .filter(entry => !search || [entry.transferNo, entry.supplier, entry.remark, ...entry.references.map(reference => reference.value),
        ...entry.items.flatMap(item => [item.name, item.productId])]
        .some(value => value.toLowerCase().includes(search)))
      .sort((left, right) => right.createdDate - left.createdDate);
    const products = new Set(transfers.flatMap(entry => entry.items.map(item => item.productId || item.name)));
    res.json({ success: true, data: {
      transfers,
      summary: {
        totalTransfers: transfers.length,
        totalProducts: products.size,
        totalQuantity: transfers.reduce((sum, entry) => sum + entry.quantity, 0),
        totalAmount: transfers.reduce((sum, entry) => sum + entry.finalTotal, 0),
      },
    } });
  } catch (error) {
    console.error("Loading stock transfer report failed:", error);
    res.status(503).json({ success: false, message: "Unable to load stock transfers right now" });
  }
});

// Read-only explicit STOCK-IN and STOCK-OUT transactions for an assigned outlet.
app.get("/api/outlets/:outletId/reports/stock-movements", async (req: Request, res: Response): Promise<void> => {
  const token = readAccessToken(req);
  if (!token) {
    res.status(401).json({ success: false, message: "Your session has expired. Please sign in again." });
    return;
  }
  const outletParam = req.params.outletId;
  const outletId = Array.isArray(outletParam) ? outletParam[0] : outletParam;
  const startDate = typeof req.query.startDate === "string" ? req.query.startDate : "";
  const endDate = typeof req.query.endDate === "string" ? req.query.endDate : startDate;
  const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if (!outletId || !validDate(startDate) || !validDate(endDate) || startDate > endDate) {
    res.status(400).json({ success: false, message: "A valid date range and outlet are required" });
    return;
  }
  const days = datesBetween(startDate, endDate);
  if (days.at(-1) !== endDate) {
    res.status(400).json({ success: false, message: "Date range cannot exceed 31 days" });
    return;
  }
  const search = typeof req.query.search === "string" ? req.query.search.trim().toLowerCase() : "";
  const direction = typeof req.query.direction === "string" ? req.query.direction : "";
  if (direction && direction !== "in" && direction !== "out") {
    res.status(400).json({ success: false, message: "Stock direction must be in or out" });
    return;
  }
  try {
    const db = getFirestoreDb();
    const profileDocument = await db.collection("USER_PROFILE").doc(token.profileDocId).get();
    const profile = profileDocument.data();
    if (!profileDocument.exists || !profile || profile.active !== true) {
      res.status(403).json({ success: false, message: "This user account is inactive or unavailable" });
      return;
    }
    if (!assignedOutletIds(profile).includes(outletId)) {
      res.status(403).json({ success: false, message: "You do not have access to this outlet" });
      return;
    }
    const goods = db.collection("OUTLET").doc(outletId).collection("GOODS_RECEIVED");
    const snapshots = await Promise.all(days.map(day => goods.where("dayID", "==", day).get()));
    const movements = snapshots.flatMap(snapshot => snapshot.docs)
      .filter(document => stockDirection(document.data()) !== null)
      .map(document => stockMovementRecord(document.id, document.data()))
      .filter(entry => !direction || entry.direction === direction)
      .filter(entry => !search || [entry.transactionNo, entry.supplier, entry.remark,
        ...entry.items.flatMap(item => [item.name, item.productId])]
        .some(value => value.toLowerCase().includes(search)))
      .sort((left, right) => right.createdDate - left.createdDate);
    const summary = movements.reduce((totals, entry) => {
      const quantity = Math.abs(entry.quantity);
      if (entry.direction === "in") totals.stockInQuantity += quantity;
      else totals.stockOutQuantity += quantity;
      totals.totalAmount += entry.finalTotal;
      return totals;
    }, { totalTransactions: movements.length, stockInQuantity: 0, stockOutQuantity: 0, totalAmount: 0 });
    res.json({ success: true, data: {
      movements,
      summary: { ...summary, netQuantity: summary.stockInQuantity - summary.stockOutQuantity },
    } });
  } catch (error) {
    console.error("Loading stock in-out report failed:", error);
    res.status(503).json({ success: false, message: "Unable to load stock movements right now" });
  }
});

// Bill-wise sales report scoped to an outlet assigned to the authenticated user.
app.get("/api/outlets/:outletId/reports/bills", async (req: Request, res: Response): Promise<void> => {
  const token = readAccessToken(req);
  if (!token) {
    res.status(401).json({ success: false, message: "Your session has expired. Please sign in again." });
    return;
  }

  const outletParam = req.params.outletId;
  const outletId = Array.isArray(outletParam) ? outletParam[0] : outletParam;
  const startDate = typeof req.query.startDate === "string" ? req.query.startDate : "";
  const endDate = typeof req.query.endDate === "string" ? req.query.endDate : startDate;
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!outletId || !datePattern.test(startDate) || !datePattern.test(endDate) || startDate > endDate) {
    res.status(400).json({ success: false, message: "A valid date range and outlet are required" });
    return;
  }

  const dateIds = datesBetween(startDate, endDate);
  if (dateIds.length === 0 || (dateIds.at(-1) !== endDate && startDate !== endDate)) {
    res.status(400).json({ success: false, message: "Date range cannot exceed 31 days" });
    return;
  }

  const shiftId = typeof req.query.shiftId === "string" ? req.query.shiftId.trim().toLowerCase() : "";
  const paymentType = typeof req.query.paymentType === "string" ? req.query.paymentType.trim().toLowerCase() : "";
  const deviceId = typeof req.query.deviceId === "string" ? req.query.deviceId.trim().toLowerCase() : "";
  const search = typeof req.query.search === "string" ? req.query.search.trim().toLowerCase() : "";
  const page = Math.max(1, Number.parseInt(typeof req.query.page === "string" ? req.query.page : "1", 10) || 1);
  const pageSize = Math.min(50, Math.max(1, Number.parseInt(typeof req.query.limit === "string" ? req.query.limit : "50", 10) || 50));

  try {
    const db = getFirestoreDb();
    const profileDocument = await db.collection("USER_PROFILE").doc(token.profileDocId).get();
    const profile = profileDocument.data();
    if (!profileDocument.exists || !profile || profile.active !== true) {
      res.status(403).json({ success: false, message: "This user account is inactive or unavailable" });
      return;
    }
    if (!assignedOutletIds(profile).includes(outletId)) {
      res.status(403).json({ success: false, message: "You do not have access to this outlet" });
      return;
    }

    const snapshots = await Promise.all(dateIds.map(dayId => db
      .collection("OUTLET")
      .doc(outletId)
      .collection("BILL_SALE_SUMMARY")
      .where("dayId", "==", dayId)
      .where("inActive", "==", false)
      .get()));

    const bills = snapshots
      .flatMap(snapshot => snapshot.docs)
      .map(document => {
        const bill = document.data();
        const payments = parsePayment(bill.payment);
        const items = Array.isArray(bill.billSaleItems) ? bill.billSaleItems.map((rawItem: unknown) => {
          const item = rawItem && typeof rawItem === "object" ? rawItem as Record<string, unknown> : {};
          const product = item.product && typeof item.product === "object"
            ? item.product as Record<string, unknown>
            : {};
          return {
            name: stringValue(product.name) || stringValue(product.shortName) || "Item",
            quantity: numberValue(item.quantity),
            price: numberValue(item.price),
            total: numberValue(item.total),
            taxPercentage: numberValue(item.taxPercentage),
            remark: item.remark ?? null
          };
        }) : [];
        const paymentModes = Object.entries(payments)
          .filter(([, amount]) => amount > 0)
          .map(([mode]) => mode);

        return {
          documentId: document.id,
          billNo: stringValue(bill.billNo) || stringValue(bill.serialNo) || document.id,
          serialNo: stringValue(bill.serialNo),
          billType: stringValue(bill.billType) || "Sale",
          dayId: stringValue(bill.dayId),
          createdDate: numberValue(bill.createdDate),
          finalTotal: numberValue(bill.finalTotal),
          taxAmount: numberValue(bill.taxAmount),
          discount: numberValue(bill.discount),
          serviceChargeAmount: numberValue(bill.serviceChargeAmount),
          roundOff: numberValue(bill.roundOff),
          shiftId: stringValue(bill.shiftId),
          deviceId: stringValue(bill.deviceId),
          table: stringValue(bill.table),
          vehicleNo: stringValue(bill.vehicleNo),
          remark: bill.remark ?? null,
          customerDetails: bill.customerDetails ?? null,
          employee: bill.employee ?? null,
          payments,
          paymentModes,
          items
        };
      })
      .filter(bill => !shiftId || bill.shiftId.toLowerCase().includes(shiftId))
      .filter(bill => !deviceId || bill.deviceId.toLowerCase().includes(deviceId))
      .filter(bill => !paymentType || numberValue(bill.payments[paymentType]) > 0)
      .filter(bill => !search
        || bill.billNo.toLowerCase().includes(search)
        || bill.serialNo.toLowerCase().includes(search)
        || bill.vehicleNo.toLowerCase().includes(search))
      .sort((left, right) => right.createdDate - left.createdDate);

    const digitalKeys = new Set(["digital", "card", "googlepay", "phonepe", "paytm", "upi"]);
    const summary = bills.reduce((totals, bill) => {
      totals.totalAmount += bill.finalTotal;
      totals.cashTotal += numberValue(bill.payments.cash);
      totals.digitalTotal += Object.entries(bill.payments)
        .filter(([mode]) => digitalKeys.has(mode.toLowerCase()))
        .reduce((sum, [, amount]) => sum + numberValue(amount), 0);
      return totals;
    }, { totalBills: bills.length, totalAmount: 0, cashTotal: 0, digitalTotal: 0 });

    const startIndex = (page - 1) * pageSize;
    res.json({
      success: true,
      data: {
        bills: bills.slice(startIndex, startIndex + pageSize),
        summary,
        pagination: {
          page,
          pageSize,
          totalItems: bills.length,
          totalPages: Math.max(1, Math.ceil(bills.length / pageSize))
        }
      }
    });
  } catch (error) {
    console.error("Loading bill-wise report failed:", error);
    res.status(503).json({ success: false, message: "Unable to load the bill-wise report right now" });
  }
});

// Category-wise sales report: aggregates billed items by product category, scoped to an assigned outlet.
app.get("/api/outlets/:outletId/reports/categories", async (req: Request, res: Response): Promise<void> => {
  const token = readAccessToken(req);
  if (!token) {
    res.status(401).json({ success: false, message: "Your session has expired. Please sign in again." });
    return;
  }

  const outletParam = req.params.outletId;
  const outletId = Array.isArray(outletParam) ? outletParam[0] : outletParam;
  const startDate = typeof req.query.startDate === "string" ? req.query.startDate : "";
  const endDate = typeof req.query.endDate === "string" ? req.query.endDate : startDate;
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!outletId || !datePattern.test(startDate) || !datePattern.test(endDate) || startDate > endDate) {
    res.status(400).json({ success: false, message: "A valid date range and outlet are required" });
    return;
  }

  const dateIds = datesBetween(startDate, endDate);
  if (dateIds.length === 0 || (dateIds.at(-1) !== endDate && startDate !== endDate)) {
    res.status(400).json({ success: false, message: "Date range cannot exceed 31 days" });
    return;
  }

  const shiftId = typeof req.query.shiftId === "string" ? req.query.shiftId.trim().toLowerCase() : "";
  const search = typeof req.query.search === "string" ? req.query.search.trim().toLowerCase() : "";

  try {
    const db = getFirestoreDb();
    const profileDocument = await db.collection("USER_PROFILE").doc(token.profileDocId).get();
    const profile = profileDocument.data();
    if (!profileDocument.exists || !profile || profile.active !== true) {
      res.status(403).json({ success: false, message: "This user account is inactive or unavailable" });
      return;
    }
    if (!assignedOutletIds(profile).includes(outletId)) {
      res.status(403).json({ success: false, message: "You do not have access to this outlet" });
      return;
    }

    const outletRef = db.collection("OUTLET").doc(outletId);
    const [categorySnapshot, ...billSnapshots] = await Promise.all([
      outletRef.collection("CATEGORY").get(),
      ...dateIds.map(dayId => outletRef
        .collection("BILL_SALE_SUMMARY")
        .where("dayId", "==", dayId)
        .where("inActive", "==", false)
        .get())
    ]);
    const categoryNames = new Map(categorySnapshot.docs.map(document => [
      document.id,
      stringValue(document.data().name) || document.id
    ]));

    const categoryNumbers = new Map(categorySnapshot.docs.map(document => {
      const value = document.data().categoryNo;
      return [document.id, typeof value === "number" && Number.isFinite(value) ? value : null] as const;
    }));

    interface ProductTotals { productId: string; name: string; quantity: number; amount: number; taxRates: Set<number | null>; taxGroups: Map<number | null, ReportTaxGroup> }
    interface CategoryTotals {
      categoryId: string; name: string; quantity: number; amount: number;
      bills: Set<string>; products: Map<string, ProductTotals>; taxRates: Set<number | null>; taxGroups: Map<number | null, ReportTaxGroup>;
    }
    const categories = new Map<string, CategoryTotals>();
    const allBills = new Set<string>();

    for (const document of billSnapshots.flatMap(snapshot => snapshot.docs)) {
      const bill = document.data();
      if (shiftId && !stringValue(bill.shiftId).toLowerCase().includes(shiftId)) continue;
      const items: unknown[] = Array.isArray(bill.billSaleItems) ? bill.billSaleItems : [];
      for (const rawItem of items) {
        const item = rawItem && typeof rawItem === "object" ? rawItem as Record<string, unknown> : {};
        if (item.deleted === true) continue;
        const product = item.product && typeof item.product === "object" ? item.product as Record<string, unknown> : {};
        const categoryId = stringValue(product.category);
        const categoryName = categoryNames.get(categoryId) || (categoryId ? "Unknown category" : "Uncategorized");
        if (search && !categoryName.toLowerCase().includes(search)) continue;

        const key = categoryId || "uncategorized";
        const totals = categories.get(key) ?? {
          categoryId: key, name: categoryName, quantity: 0, amount: 0, bills: new Set<string>(), products: new Map(), taxRates: new Set<number | null>(), taxGroups: new Map<number | null, ReportTaxGroup>()
        };
        const productName = stringValue(product.name) || stringValue(product.shortName) || "Item";
        const productId = stringValue(product.id) || productName;
        const productTotals = totals.products.get(productId) ?? { productId, name: productName, quantity: 0, amount: 0, taxRates: new Set<number | null>(), taxGroups: new Map<number | null, ReportTaxGroup>() };

        const taxRate = historicalReportTaxRate(bill, item);
        totals.taxRates.add(taxRate);
        productTotals.taxRates.add(taxRate);
        addReportTaxGroup(totals.taxGroups, bill, item, productId);
        addReportTaxGroup(productTotals.taxGroups, bill, item, productId);
        totals.quantity += numberValue(item.quantity);
        totals.amount += numberValue(item.total);
        totals.bills.add(document.id);
        productTotals.quantity += numberValue(item.quantity);
        productTotals.amount += numberValue(item.total);
        totals.products.set(productId, productTotals);
        categories.set(key, totals);
        allBills.add(document.id);
      }
    }

    const totalAmount = [...categories.values()].reduce((sum, category) => sum + category.amount, 0);
    const rows = [...categories.values()]
      .map(category => ({
        categoryId: category.categoryId,
        categoryNo: categoryNumbers.get(category.categoryId) ?? null,
        taxRate: reportTaxRateLabel(category.taxRates),
        taxBreakdown: reportTaxBreakdown(category.taxGroups),
        taxAmount: reportTaxAmount(category.taxGroups),
        name: category.name,
        billCount: category.bills.size,
        productCount: category.products.size,
        quantity: category.quantity,
        amount: category.amount,
        share: totalAmount > 0 ? (category.amount / totalAmount) * 100 : 0,
        products: [...category.products.values()]
          .map(({ taxRates, taxGroups, ...product }) => ({
            ...product, taxRate: reportTaxRateLabel(taxRates),
            taxBreakdown: reportTaxBreakdown(taxGroups), taxAmount: reportTaxAmount(taxGroups),
          }))
          .sort((left, right) => right.amount - left.amount)
      }))
      .sort((left, right) => right.amount - left.amount);

    res.json({
      success: true,
      data: {
        categories: rows,
        summary: {
          totalCategories: rows.length,
          totalBills: allBills.size,
          totalQuantity: rows.reduce((sum, row) => sum + row.quantity, 0),
          totalAmount,
          totalTax: rows.reduce((sum, row) => sum + row.taxAmount, 0),
        }
      }
    });
  } catch (error) {
    console.error("Loading category-wise report failed:", error);
    res.status(503).json({ success: false, message: "Unable to load the category-wise report right now" });
  }
});

// Read-only category master for an assigned outlet. Nothing is written to Firestore.
app.get("/api/outlets/:outletId/categories", async (req: Request, res: Response): Promise<void> => {
  const token = readAccessToken(req);
  if (!token) {
    res.status(401).json({ success: false, message: "Your session has expired. Please sign in again." });
    return;
  }

  const outletParam = req.params.outletId;
  const outletId = Array.isArray(outletParam) ? outletParam[0] : outletParam;
  if (!outletId) {
    res.status(400).json({ success: false, message: "A valid outlet is required" });
    return;
  }

  try {
    const db = getFirestoreDb();
    const profileDocument = await db.collection("USER_PROFILE").doc(token.profileDocId).get();
    const profile = profileDocument.data();
    if (!profileDocument.exists || !profile || profile.active !== true) {
      res.status(403).json({ success: false, message: "This user account is inactive or unavailable" });
      return;
    }
    if (!assignedOutletIds(profile).includes(outletId)) {
      res.status(403).json({ success: false, message: "You do not have access to this outlet" });
      return;
    }

    const outletRef = db.collection("OUTLET").doc(outletId);
    const [categorySnapshot, productSnapshot] = await Promise.all([
      outletRef.collection("CATEGORY").get(),
      outletRef.collection("PRODUCT").get()
    ]);

    const productCounts = new Map<string, number>();
    for (const document of productSnapshot.docs) {
      const categoryId = stringValue(document.data().category);
      if (categoryId) productCounts.set(categoryId, (productCounts.get(categoryId) ?? 0) + 1);
    }

    const categories = categorySnapshot.docs
      .map(document => {
        const category = document.data();
        return {
          id: document.id,
          categoryNo: typeof category.categoryNo === "number" && Number.isFinite(category.categoryNo) ? category.categoryNo : null,
          name: stringValue(category.name),
          regionalName: stringValue(category.regionalName),
          dayType: stringValue(category.dayType),
          active: typeof category.inActive === "boolean" || typeof category.active === "boolean"
            ? category.inActive !== true && category.active !== false : null,
          productCount: productCounts.get(document.id) ?? 0,
          createdAt: document.createTime?.toDate().toISOString() ?? ""
        };
      })
      .sort((left, right) => (left.categoryNo ?? 0) - (right.categoryNo ?? 0) || left.name.localeCompare(right.name));

    res.json({ success: true, data: categories });
  } catch (error) {
    console.error("Loading outlet categories failed:", error);
    res.status(503).json({ success: false, message: "Unable to load categories right now" });
  }
});

// Read the complete product documents without renaming fields or writing to Firestore.
app.get("/api/outlets/:outletId/products", async (req: Request, res: Response): Promise<void> => {
  const token = readAccessToken(req);
  if (!token) {
    res.status(401).json({ success: false, message: "Your session has expired. Please sign in again." });
    return;
  }

  const outletParam = req.params.outletId;
  const outletId = Array.isArray(outletParam) ? outletParam[0] : outletParam;
  if (!outletId || outletId.includes("/")) {
    res.status(400).json({ success: false, message: "A valid outlet is required" });
    return;
  }

  try {
    const db = getFirestoreDb();
    const profileDocument = await db.collection("USER_PROFILE").doc(token.profileDocId).get();
    const profile = profileDocument.data();
    if (!profileDocument.exists || !profile || profile.active !== true) {
      res.status(403).json({ success: false, message: "This user account is inactive or unavailable" });
      return;
    }
    if (!assignedOutletIds(profile).includes(outletId)) {
      res.status(403).json({ success: false, message: "You do not have access to this outlet" });
      return;
    }

    const snapshot = await db.collection("OUTLET").doc(outletId).collection("PRODUCT").get();
    // Keep the document ID separate so a stored `id` field is preserved too.
    res.json({ success: true, data: snapshot.docs.map(document => ({
      documentId: document.id,
      fields: document.data()
    })) });
  } catch (error) {
    console.error("Loading outlet products failed:", error);
    res.status(503).json({ success: false, message: "Unable to load products right now" });
  }
});

app.get("/api/outlets/:outletId/products/:documentId/edit-options", async (req: Request, res: Response): Promise<void> => {
  try {
    const token = readAccessToken(req);
    const outletId = String(req.params.outletId ?? '');
    const id = String(req.params.documentId ?? '');
    const deps = productImportDependencies();
    requireProductOutlet(token?.profileDocId ?? null, outletId,
      token ? await deps.readProfile(token.profileDocId) : undefined, assignedOutletIds);
    if (!id || id.includes('/') || id === '.' || id === '..') throw new ProductCreationError(400, 'A valid product ID is required.');
    const [snapshot, categories, taxes] = await Promise.all([
      getFirestoreDb().collection('OUTLET').doc(outletId).collection('PRODUCT').doc(id).get(),
      deps.readCategories(outletId), deps.readTaxes(),
    ]);
    if (!snapshot.exists) throw new ProductCreationError(404, 'This product no longer exists.');
    const fields = snapshot.data()!;
    res.json({ success: true, data: { code: typeof fields.code === 'string' || typeof fields.code === 'number' ? fields.code : '',
      categories, taxes: productTaxes(taxes), units: PRODUCT_UNITS, product: { documentId: id, fields } } });
  } catch (error) { productCreationResponse(res, error); }
});

app.patch("/api/outlets/:outletId/products/:documentId", async (req: Request, res: Response): Promise<void> => {
  try {
    const data = await updateOutletProduct(getFirestoreDb(), String(req.params.outletId ?? ''),
      String(req.params.documentId ?? ''), readAccessToken(req)?.profileDocId ?? null, assignedOutletIds, req.body);
    res.json({ success: true, data });
  } catch (error) { productCreationResponse(res, error); }
});

app.patch("/api/outlets/:outletId/categories/:documentId", async (req: Request, res: Response): Promise<void> => {
  try {
    const data = await updateCategoryNames(getFirestoreDb(), String(req.params.outletId ?? ''),
      String(req.params.documentId ?? ''), readAccessToken(req)?.profileDocId ?? null, assignedOutletIds, req.body);
    res.json({ success: true, data });
  } catch (error) {
    res.status(error instanceof CategoryUpdateError ? error.status : 503).json({ success: false,
      message: error instanceof CategoryUpdateError ? error.message : 'Unable to update category. Retry with the same names to confirm the outcome.' });
  }
});

// Existing outlet master documents only; never use the legacy in-memory category API.
for (const [route, collection] of [['categories', 'CATEGORY'], ['products', 'PRODUCT']] as const) {
  app.delete(`/api/outlets/:outletId/${route}/:documentId`, async (req: Request, res: Response): Promise<void> => {
    try {
      const result = await deleteOutletRecord(getFirestoreDb(), String(req.params.outletId ?? ''), collection,
        String(req.params.documentId ?? ''), readAccessToken(req)?.profileDocId ?? null, assignedOutletIds);
      res.json({ success: true, data: result });
    } catch (error) {
      res.status(error instanceof OutletDeletionError ? error.status : 503).json({ success: false,
        message: error instanceof OutletDeletionError ? error.message : 'Unable to delete this record. Retry to confirm the outcome.' });
    }
  });
}

// Form configuration is read only, scoped to the same authorized outlet as product imports.
app.get("/api/outlets/:outletId/products/create-options", async (req: Request, res: Response): Promise<void> => {
  try {
    const token = readAccessToken(req);
    const outletId = String(req.params.outletId ?? '');
    const deps = productImportDependencies();
    const profile = token ? await deps.readProfile(token.profileDocId) : undefined;
    requireProductOutlet(token?.profileDocId ?? null, outletId, profile, assignedOutletIds);
    const [categories, taxes, products] = await Promise.all([
      deps.readCategories(outletId), deps.readTaxes(), deps.readProducts(outletId),
    ]);
    res.json({ success: true, data: { code: nextProductCode(products), categories,
      taxes: productTaxes(taxes), units: PRODUCT_UNITS } });
  } catch (error) { productCreationResponse(res, error); }
});

app.post("/api/outlets/:outletId/products", async (req: Request, res: Response): Promise<void> => {
  try {
    const product = await createOutletProduct(getFirestoreDb(), String(req.params.outletId ?? ''),
      readAccessToken(req)?.profileDocId ?? null, assignedOutletIds, req.body);
    res.status(201).json({ success: true, data: product });
  } catch (error) { productCreationResponse(res, error); }
});

function productCreationResponse(res: Response, error: unknown) {
  if (error instanceof ProductCreationError) {
    res.status(error.status).json({ success: false, message: error.message, errors: error.errors, nextCode: error.nextCode });
  } else {
    res.status(409).json({ success: false, message: error instanceof Error && /^(Row \d+ already|An existing product differs|An existing numeric Search Code|No safe numeric Search Codes)/.test(error.message)
      ? error.message.replace(/^Row \d+ already/, 'This product already') : 'Unable to save or load product details. Retry with the same form to reconcile the outcome.' });
  }
}

// Existing readers and authentication are reused; production writes remain gated.
function productImportDependencies() {
  return {
    readProfile: async (id: string) => (await getFirestoreDb().collection("USER_PROFILE").doc(id).get()).data(),
    assignedOutlets: assignedOutletIds,
    readCategories: async (id: string) => {
      const snapshot = await getFirestoreDb().collection("OUTLET").doc(id).collection("CATEGORY").get();
      return snapshot.docs.map(document => ({ id: document.id, name: stringValue(document.data().name),
        categoryNo: typeof document.data().categoryNo === "number" ? document.data().categoryNo as number : null }));
    },
    readProducts: async (id: string) => (await getFirestoreDb().collection("OUTLET").doc(id).collection("PRODUCT").get()).docs
      .map(document => ({ id: document.id, fields: document.data() })),
    readTaxes: async () => {
      const snapshot = await getFirestoreDb().collection("MASTERS").doc("masters").collection("TAX_MASTER").get();
      return snapshot.docs.map(document => document.data()).filter(data =>
        typeof data.percent === "number" && Number.isFinite(data.percent)
        && typeof data.index === "number" && Number.isSafeInteger(data.index)
        && typeof data.type === "number" && Number.isSafeInteger(data.type)
      ).map(data => ({ percent: data.percent as number, index: data.index as number, type: data.type as number }));
    },
  };
}

app.post("/api/outlets/:outletId/products/import/validate", async (req: Request, res: Response): Promise<void> => {
  const token = readAccessToken(req);
  const parameter = req.params.outletId;
  const outletId = Array.isArray(parameter) ? parameter[0] ?? "" : parameter ?? "";
  try {
    const result = await checkAuthorizedProductImport(token?.profileDocId ?? null, outletId, req.body?.source, productImportDependencies());
    res.status(result.status).json({ ...result.body, writesEnabled: PRODUCT_IMPORT_WRITES_ENABLED });
  } catch {
    res.status(503).json({ success: false, message: "Unable to validate the import. No products were written." });
  }
});

app.post("/api/outlets/:outletId/products/import", async (req: Request, res: Response): Promise<void> => {
  const token = readAccessToken(req);
  const parameter = req.params.outletId;
  const outletId = Array.isArray(parameter) ? parameter[0] ?? "" : parameter ?? "";
  try {
    const checked = await checkAuthorizedProductImport(token?.profileDocId ?? null, outletId, req.body?.source, productImportDependencies());
    if (checked.status !== 200 || !checked.body.data?.canUpload) {
      res.status(checked.status).json(checked.body); return;
    }
    if (!PRODUCT_IMPORT_WRITES_ENABLED) {
      res.status(403).json({ success: false, message: "File validated. Production upload is disabled pending review and approval. No products were saved." }); return;
    }
    const codes: unknown = req.body?.codes;
    if (!Array.isArray(codes) || codes.length !== checked.body.data.documents.length
      || codes.some((code, index) => code !== checked.body.data!.documents[index]!.fields.code)) {
      res.status(409).json({ success: false, message: "Search Codes changed or were not previewed. Review the updated preview before uploading again." }); return;
    }
    const result = await productImportQuota.run(outletId, req.body.source, () => persistProductImport(outletId, checked.body.data!.documents, {
      enabled: PRODUCT_IMPORT_WRITES_ENABLED,
      readExisting: async id => (await getFirestoreDb().collection("OUTLET").doc(id).collection("PRODUCT").get()).docs
        .map(document => ({ id: document.id, fields: document.data() })),
      createChunk: (id, documents) => createProductImportChunk(getFirestoreDb(), id, documents),
    }));
    res.status(result.success ? 200 : 503).json({ success: result.success, data: result });
  } catch (error) {
    if (error instanceof ProductImportQuotaError) {
      res.setHeader("Retry-After", String(error.retryAfterSeconds));
      res.status(429).json({ success: false, message: error.message, nextAvailableAt: error.nextAvailableAt });
      return;
    }
    res.status(409).json({ success: false, message: error instanceof Error && /^(Row \d+ already|Search Codes changed|An existing product differs|An existing numeric Search Code|No safe numeric Search Codes)/.test(error.message)
      ? error.message : "Import could not be completed. Keep the same file for reconciliation; existing products were not overwritten." });
  }
});

// Creates a new category document only; existing category records are never updated.
app.post("/api/outlets/:outletId/categories", async (req: Request, res: Response): Promise<void> => {
  const token = readAccessToken(req);
  if (!token) {
    res.status(401).json({ success: false, message: "Your session has expired. Please sign in again." });
    return;
  }
  const outletParam = req.params.outletId;
  const outletId = Array.isArray(outletParam) ? outletParam[0] : outletParam;
  const input = z.object({
    categoryNo: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    name: z.string().trim().min(1).max(200),
    regionalName: z.string().trim().max(200).default(""),
    dayType: z.string().trim().max(100).default(""),
  }).safeParse(req.body);
  if (!outletId || !input.success) {
    res.status(400).json({ success: false, message: "A category name and positive whole category number are required." });
    return;
  }
  try {
    const db = getFirestoreDb();
    const profileDocument = await db.collection("USER_PROFILE").doc(token.profileDocId).get();
    const profile = profileDocument.data();
    if (!profileDocument.exists || !profile || profile.active !== true) {
      res.status(403).json({ success: false, message: "This user account is inactive or unavailable" });
      return;
    }
    if (!assignedOutletIds(profile).includes(outletId)) {
      res.status(403).json({ success: false, message: "You do not have access to this outlet" });
      return;
    }
    const collection = db.collection("OUTLET").doc(outletId).collection("CATEGORY");
    const reference = collection.doc();
    const duplicate = await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(collection);
      const exists = snapshot.docs.some(document => {
        const category = document.data();
        return category.categoryNo === input.data.categoryNo
          || stringValue(category.name).trim().toLowerCase() === input.data.name.toLowerCase();
      });
      if (exists) return true;
      // Match the existing CATEGORY document format; UI metadata is never stored.
      transaction.create(reference, {
        categoryNo: input.data.categoryNo,
        dayType: input.data.dayType,
        id: reference.id,
        name: input.data.name,
        onlineSynced: false,
        regionalName: input.data.regionalName,
        selected: false,
      });
      return false;
    });
    if (duplicate) {
      res.status(409).json({ success: false, message: "A category with this number or name already exists." });
      return;
    }
    const created = await reference.get();
    res.status(201).json({ success: true, data: {
      id: reference.id,
      ...input.data,
      active: null,
      productCount: 0,
      createdAt: created.createTime?.toDate().toISOString() ?? "",
    } });
  } catch (error) {
    console.error("Creating category failed:", error);
    res.status(503).json({ success: false, message: "Unable to add the category right now." });
  }
});

// Stock report: current stock count for the stockable products of an assigned outlet (read-only).
app.get("/api/outlets/:outletId/reports/stock", async (req: Request, res: Response): Promise<void> => {
  const token = readAccessToken(req);
  if (!token) {
    res.status(401).json({ success: false, message: "Your session has expired. Please sign in again." });
    return;
  }

  const outletParam = req.params.outletId;
  const outletId = Array.isArray(outletParam) ? outletParam[0] : outletParam;
  if (!outletId) {
    res.status(400).json({ success: false, message: "A valid outlet is required" });
    return;
  }

  try {
    const db = getFirestoreDb();
    const profileDocument = await db.collection("USER_PROFILE").doc(token.profileDocId).get();
    const profile = profileDocument.data();
    if (!profileDocument.exists || !profile || profile.active !== true) {
      res.status(403).json({ success: false, message: "This user account is inactive or unavailable" });
      return;
    }
    if (!assignedOutletIds(profile).includes(outletId)) {
      res.status(403).json({ success: false, message: "You do not have access to this outlet" });
      return;
    }

    const outletRef = db.collection("OUTLET").doc(outletId);
    const [categorySnapshot, productSnapshot] = await Promise.all([
      outletRef.collection("CATEGORY").get(),
      outletRef.collection("PRODUCT").where("stockable", "==", true).get()
    ]);
    const categoryNames = new Map(categorySnapshot.docs.map(document => [
      document.id,
      stringValue(document.data().name).trim() || document.id
    ]));

    const products = productSnapshot.docs
      .map(document => {
        const product = document.data();
        const categoryId = stringValue(product.category);
        const currentStock = numberValue(product.currentStock);
        const reorderLevel = numberValue(product.reorderLevel);
        const tracked = product.stockable === true;
        const status = !tracked ? "Not tracked"
          : currentStock <= 0 ? "Out of stock"
          : reorderLevel > 0 && currentStock <= reorderLevel ? "Low stock"
          : "In stock";
        return {
          productId: document.id,
          code: typeof product.code === "number" ? String(product.code) : stringValue(product.code).trim(),
          name: stringValue(product.name).trim() || stringValue(product.shortName).trim() || "Unnamed product",
          categoryId,
          category: categoryNames.get(categoryId) || (categoryId ? "Unknown category" : "Uncategorized"),
          tracked,
          currentStock,
          reorderLevel,
          price: numberValue(product.price),
          costPrice: numberValue(product.costPrice),
          stockValue: tracked ? Math.max(0, currentStock) * numberValue(product.price) : 0,
          status
        };
      })
      .sort((left, right) => left.code.localeCompare(right.code, undefined, { numeric: true }) || left.name.localeCompare(right.name));

    res.json({
      success: true,
      data: {
        products,
        categories: [...categoryNames.entries()]
          .map(([id, name]) => ({ id, name }))
          .sort((left, right) => left.name.localeCompare(right.name))
      }
    });
  } catch (error) {
    console.error("Loading stock report failed:", error);
    res.status(503).json({ success: false, message: "Unable to load the stock report right now" });
  }
});

// GST report: taxable value, CGST/SGST/IGST and GST-inclusive totals per rate and per bill.
app.get("/api/outlets/:outletId/reports/gst", async (req: Request, res: Response): Promise<void> => {
  const token = readAccessToken(req);
  if (!token) {
    res.status(401).json({ success: false, message: "Your session has expired. Please sign in again." });
    return;
  }

  const outletParam = req.params.outletId;
  const outletId = Array.isArray(outletParam) ? outletParam[0] : outletParam;
  const startDate = typeof req.query.startDate === "string" ? req.query.startDate : "";
  const endDate = typeof req.query.endDate === "string" ? req.query.endDate : startDate;
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!outletId || !datePattern.test(startDate) || !datePattern.test(endDate) || startDate > endDate) {
    res.status(400).json({ success: false, message: "A valid date range and outlet are required" });
    return;
  }

  const dateIds = datesBetween(startDate, endDate);
  if (dateIds.length === 0 || (dateIds.at(-1) !== endDate && startDate !== endDate)) {
    res.status(400).json({ success: false, message: "Date range cannot exceed 31 days" });
    return;
  }

  const shiftId = typeof req.query.shiftId === "string" ? req.query.shiftId.trim().toLowerCase() : "";
  const taxTypeFilter = typeof req.query.taxType === "string" ? req.query.taxType.trim().toLowerCase() : "";
  const search = typeof req.query.search === "string" ? req.query.search.trim().toLowerCase() : "";

  try {
    const db = getFirestoreDb();
    const profileDocument = await db.collection("USER_PROFILE").doc(token.profileDocId).get();
    const profile = profileDocument.data();
    if (!profileDocument.exists || !profile || profile.active !== true) {
      res.status(403).json({ success: false, message: "This user account is inactive or unavailable" });
      return;
    }
    if (!assignedOutletIds(profile).includes(outletId)) {
      res.status(403).json({ success: false, message: "You do not have access to this outlet" });
      return;
    }

    const snapshots = await Promise.all(dateIds.map(dayId => db
      .collection("OUTLET")
      .doc(outletId)
      .collection("BILL_SALE_SUMMARY")
      .where("dayId", "==", dayId)
      .where("inActive", "==", false)
      .get()));

    interface GstTotals { taxable: number; cgst: number; sgst: number; igst: number; gst: number; gross: number }
    const emptyTotals = (): GstTotals => ({ taxable: 0, cgst: 0, sgst: 0, igst: 0, gst: 0, gross: 0 });
    const addTotals = (target: GstTotals, source: GstTotals) => {
      target.taxable += source.taxable;
      target.cgst += source.cgst;
      target.sgst += source.sgst;
      target.igst += source.igst;
      target.gst += source.gst;
      target.gross += source.gross;
    };

    const rates = new Map<number, GstTotals & { rate: number; itemCount: number; bills: Set<string> }>();
    const bills: Array<GstTotals & {
      documentId: string; billNo: string; dayId: string; createdDate: number; taxType: string;
      shiftId: string; rates: number[]; finalTotal: number;
      items: Array<GstTotals & { name: string; code: string; quantity: number; price: number; rate: number }>;
    }> = [];

    for (const document of snapshots.flatMap(snapshot => snapshot.docs)) {
      const bill = document.data();
      const billNo = stringValue(bill.billNo) || stringValue(bill.serialNo) || document.id;
      const rawTaxType = stringValue(bill.taxType) || "NoTax";
      const taxType = rawTaxType.toLowerCase();
      if (shiftId && !stringValue(bill.shiftId).toLowerCase().includes(shiftId)) continue;
      if (taxTypeFilter && taxType !== taxTypeFilter) continue;
      if (search && !billNo.toLowerCase().includes(search) && !stringValue(bill.serialNo).toLowerCase().includes(search)) continue;

      const billTotals = emptyTotals();
      const billRates = new Set<number>();
      const billItems: (typeof bills)[number]["items"] = [];
      const items: unknown[] = Array.isArray(bill.billSaleItems) ? bill.billSaleItems : [];
      for (const rawItem of items) {
        const item = rawItem && typeof rawItem === "object" ? rawItem as Record<string, unknown> : {};
        if (item.deleted === true) continue;
        const lineTotal = numberValue(item.total);
        const rate = taxType === "notax" ? 0 : numberValue(item.taxPercentage);

        // Inclusive prices already contain GST; exclusive prices have GST added on top.
        const gst = rate <= 0 ? 0
          : taxType === "inclusive" ? lineTotal - lineTotal / (1 + rate / 100)
          : lineTotal * rate / 100;
        const taxable = taxType === "inclusive" ? lineTotal - gst : lineTotal;

        // Split using the POS's own tax lines when present; otherwise assume intra-state (half CGST, half SGST).
        const taxItems: unknown[] = Array.isArray(item.taxItems) ? item.taxItems : [];
        const split = { cgst: 0, sgst: 0, igst: 0 };
        for (const rawTax of taxItems) {
          const tax = rawTax && typeof rawTax === "object" ? rawTax as Record<string, unknown> : {};
          const title = stringValue(tax.title).toUpperCase();
          if (title === "CGST") split.cgst += numberValue(tax.value);
          else if (title === "SGST") split.sgst += numberValue(tax.value);
          else if (title === "IGST") split.igst += numberValue(tax.value);
        }
        const splitSum = split.cgst + split.sgst + split.igst;
        const lineTotals: GstTotals = splitSum > 0
          ? { taxable, cgst: gst * split.cgst / splitSum, sgst: gst * split.sgst / splitSum, igst: gst * split.igst / splitSum, gst, gross: taxable + gst }
          : { taxable, cgst: gst / 2, sgst: gst / 2, igst: 0, gst, gross: taxable + gst };

        const rateTotals = rates.get(rate) ?? { ...emptyTotals(), rate, itemCount: 0, bills: new Set<string>() };
        addTotals(rateTotals, lineTotals);
        rateTotals.itemCount += numberValue(item.quantity);
        rateTotals.bills.add(document.id);
        rates.set(rate, rateTotals);
        addTotals(billTotals, lineTotals);
        billRates.add(rate);

        const product = item.product && typeof item.product === "object" ? item.product as Record<string, unknown> : {};
        billItems.push({
          name: stringValue(product.name).trim() || stringValue(product.shortName).trim() || "Item",
          code: typeof product.code === "number" ? String(product.code) : stringValue(product.code).trim(),
          quantity: numberValue(item.quantity),
          price: numberValue(item.price),
          rate,
          ...lineTotals
        });
      }

      bills.push({
        documentId: document.id,
        billNo,
        dayId: stringValue(bill.dayId),
        createdDate: numberValue(bill.createdDate),
        taxType: rawTaxType,
        shiftId: stringValue(bill.shiftId),
        rates: [...billRates].sort((left, right) => left - right),
        finalTotal: numberValue(bill.finalTotal),
        items: billItems,
        ...billTotals
      });
    }

    const summary = { ...emptyTotals(), totalBills: bills.length, gstBills: bills.filter(bill => bill.gst > 0).length };
    for (const bill of bills) addTotals(summary, bill);

    res.json({
      success: true,
      data: {
        rates: [...rates.values()]
          .map(({ bills: rateBills, ...totals }) => ({ ...totals, billCount: rateBills.size }))
          .sort((left, right) => left.rate - right.rate),
        bills: bills.sort((left, right) => right.createdDate - left.createdDate),
        summary
      }
    });
  } catch (error) {
    console.error("Loading GST report failed:", error);
    res.status(503).json({ success: false, message: "Unable to load the GST report right now" });
  }
});

// Product-wise sales report with product codes, scoped to an assigned outlet.
app.get("/api/outlets/:outletId/reports/products", async (req: Request, res: Response): Promise<void> => {
  const token = readAccessToken(req);
  if (!token) {
    res.status(401).json({ success: false, message: "Your session has expired. Please sign in again." });
    return;
  }

  const outletParam = req.params.outletId;
  const outletId = Array.isArray(outletParam) ? outletParam[0] : outletParam;
  const startDate = typeof req.query.startDate === "string" ? req.query.startDate : "";
  const endDate = typeof req.query.endDate === "string" ? req.query.endDate : startDate;
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!outletId || !datePattern.test(startDate) || !datePattern.test(endDate) || startDate > endDate) {
    res.status(400).json({ success: false, message: "A valid date range and outlet are required" });
    return;
  }

  const dateIds = datesBetween(startDate, endDate);
  if (dateIds.length === 0 || (dateIds.at(-1) !== endDate && startDate !== endDate)) {
    res.status(400).json({ success: false, message: "Date range cannot exceed 31 days" });
    return;
  }

  const shiftId = typeof req.query.shiftId === "string" ? req.query.shiftId.trim().toLowerCase() : "";
  const search = typeof req.query.search === "string" ? req.query.search.trim().toLowerCase() : "";

  try {
    const db = getFirestoreDb();
    const profileDocument = await db.collection("USER_PROFILE").doc(token.profileDocId).get();
    const profile = profileDocument.data();
    if (!profileDocument.exists || !profile || profile.active !== true) {
      res.status(403).json({ success: false, message: "This user account is inactive or unavailable" });
      return;
    }
    if (!assignedOutletIds(profile).includes(outletId)) {
      res.status(403).json({ success: false, message: "You do not have access to this outlet" });
      return;
    }

    const outletRef = db.collection("OUTLET").doc(outletId);
    const [categorySnapshot, productSnapshot, ...billSnapshots] = await Promise.all([
      outletRef.collection("CATEGORY").get(),
      outletRef.collection("PRODUCT").get(),
      ...dateIds.map(dayId => outletRef
        .collection("BILL_SALE_SUMMARY")
        .where("dayId", "==", dayId)
        .where("inActive", "==", false)
        .get())
    ]);
    const categoryNames = new Map(categorySnapshot.docs.map(document => [
      document.id,
      stringValue(document.data().name) || document.id
    ]));
    // Product master codes take precedence over the copy saved on each bill item.
    const productCodes = new Map(productSnapshot.docs.map(document => [document.id, document.data().code]));
    const codeLabel = (value: unknown): string =>
      typeof value === "number" && Number.isFinite(value) ? String(value) : stringValue(value).trim();

    interface ProductTotals {
      productId: string; code: string; name: string; category: string;
      quantity: number; amount: number; bills: Set<string>; taxRates: Set<number | null>; taxGroups: Map<number | null, ReportTaxGroup>;
    }
    const products = new Map<string, ProductTotals>();
    const allBills = new Set<string>();

    for (const document of billSnapshots.flatMap(snapshot => snapshot.docs)) {
      const bill = document.data();
      if (shiftId && !stringValue(bill.shiftId).toLowerCase().includes(shiftId)) continue;
      const items: unknown[] = Array.isArray(bill.billSaleItems) ? bill.billSaleItems : [];
      for (const rawItem of items) {
        const item = rawItem && typeof rawItem === "object" ? rawItem as Record<string, unknown> : {};
        if (item.deleted === true) continue;
        const product = item.product && typeof item.product === "object" ? item.product as Record<string, unknown> : {};
        const name = stringValue(product.name).trim() || stringValue(product.shortName).trim() || "Item";
        const productId = stringValue(product.id) || name;
        const code = codeLabel(productCodes.get(productId)) || codeLabel(product.code);
        const categoryId = stringValue(product.category);
        const category = categoryNames.get(categoryId) || (categoryId ? "Unknown category" : "Uncategorized");
        if (search
          && !name.toLowerCase().includes(search)
          && !code.toLowerCase().includes(search)
          && !category.toLowerCase().includes(search)) continue;

        const totals = products.get(productId) ?? {
          productId, code, name, category, quantity: 0, amount: 0, bills: new Set<string>(), taxRates: new Set<number | null>(), taxGroups: new Map<number | null, ReportTaxGroup>()
        };
        totals.taxRates.add(historicalReportTaxRate(bill, item));
        addReportTaxGroup(totals.taxGroups, bill, item, productId);
        totals.quantity += numberValue(item.quantity);
        totals.amount += numberValue(item.total);
        totals.bills.add(document.id);
        products.set(productId, totals);
        allBills.add(document.id);
      }
    }

    const totalAmount = [...products.values()].reduce((sum, product) => sum + product.amount, 0);
    const rows = [...products.values()]
      .map(product => ({
        productId: product.productId,
        taxRate: reportTaxRateLabel(product.taxRates),
        taxBreakdown: reportTaxBreakdown(product.taxGroups),
        taxAmount: reportTaxAmount(product.taxGroups),
        code: product.code,
        name: product.name,
        category: product.category,
        billCount: product.bills.size,
        quantity: product.quantity,
        averageRate: product.quantity > 0 ? product.amount / product.quantity : 0,
        amount: product.amount,
        share: totalAmount > 0 ? (product.amount / totalAmount) * 100 : 0
      }))
      .sort((left, right) => right.amount - left.amount);

    res.json({
      success: true,
      data: {
        products: rows,
        summary: {
          totalProducts: rows.length,
          totalBills: allBills.size,
          totalQuantity: rows.reduce((sum, row) => sum + row.quantity, 0),
          totalAmount,
          totalTax: rows.reduce((sum, row) => sum + row.taxAmount, 0),
        }
      }
    });
  } catch (error) {
    console.error("Loading product-wise report failed:", error);
    res.status(503).json({ success: false, message: "Unable to load the product-wise report right now" });
  }
});

// Shift summary report: every shift per day ID within the range, scoped to an assigned outlet.
app.get("/api/outlets/:outletId/reports/shifts", async (req: Request, res: Response): Promise<void> => {
  const token = readAccessToken(req);
  if (!token) {
    res.status(401).json({ success: false, message: "Your session has expired. Please sign in again." });
    return;
  }

  const outletParam = req.params.outletId;
  const outletId = Array.isArray(outletParam) ? outletParam[0] : outletParam;
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const dayIdFilter = typeof req.query.dayId === "string" ? req.query.dayId.trim() : "";
  const startDate = typeof req.query.startDate === "string" ? req.query.startDate : "";
  const endDate = typeof req.query.endDate === "string" ? req.query.endDate : startDate;
  if (dayIdFilter && !datePattern.test(dayIdFilter)) {
    res.status(400).json({ success: false, message: "Day ID must be in YYYY-MM-DD format" });
    return;
  }
  if (!outletId || (!dayIdFilter && (!datePattern.test(startDate) || !datePattern.test(endDate) || startDate > endDate))) {
    res.status(400).json({ success: false, message: "A valid date range and outlet are required" });
    return;
  }

  // A specific day ID takes precedence over the date range.
  const dateIds = dayIdFilter ? [dayIdFilter] : datesBetween(startDate, endDate);
  if (!dayIdFilter && (dateIds.length === 0 || (dateIds.at(-1) !== endDate && startDate !== endDate))) {
    res.status(400).json({ success: false, message: "Date range cannot exceed 31 days" });
    return;
  }

  const shiftNo = typeof req.query.shiftNo === "string" ? Number.parseInt(req.query.shiftNo, 10) : Number.NaN;
  const deviceId = typeof req.query.deviceId === "string" ? req.query.deviceId.trim().toLowerCase() : "";

  try {
    const db = getFirestoreDb();
    const profileDocument = await db.collection("USER_PROFILE").doc(token.profileDocId).get();
    const profile = profileDocument.data();
    if (!profileDocument.exists || !profile || profile.active !== true) {
      res.status(403).json({ success: false, message: "This user account is inactive or unavailable" });
      return;
    }
    if (!assignedOutletIds(profile).includes(outletId)) {
      res.status(403).json({ success: false, message: "You do not have access to this outlet" });
      return;
    }

    const snapshots = await Promise.all(dateIds.map(dayId => db
      .collection("OUTLET")
      .doc(outletId)
      .collection("SHIFT")
      .where("dayId", "==", dayId)
      .get()));

    const shifts = snapshots
      .flatMap(snapshot => snapshot.docs)
      .map(document => {
        const shift = document.data();
        return {
          id: document.id,
          dayId: stringValue(shift.dayId),
          shiftNo: numberValue(shift.shiftNo),
          deviceId: stringValue(shift.deviceId),
          inActive: shift.inActive === true,
          startTime: numberValue(shift.startTime),
          endTime: numberValue(shift.endTime),
          startBillNo: stringValue(shift.startBillNo),
          lastBillNo: stringValue(shift.lastBillNo),
          lastBillTime: numberValue(shift.lastBillTime),
          billCount: numberValue(shift.billCount),
          billDeletesNumber: numberValue(shift.billDeletesNumber),
          billDeletesAmount: numberValue(shift.billDeletesAmount),
          openingAmt: numberValue(shift.openingAmt),
          totalSale: numberValue(shift.totalSale),
          cashSale: numberValue(shift.cashSale),
          digitalSale: numberValue(shift.digitalSale),
          creditSale: numberValue(shift.creditSale),
          subTotalBill: numberValue(shift.subTotalBill),
          discount: numberValue(shift.discount),
          tax: numberValue(shift.tax),
          gstTotal: numberValue(shift.gstTotal),
          vatTotal: numberValue(shift.vatTotal),
          refundAmount: numberValue(shift.refundAmount),
          extraCharges: numberValue(shift.extraCharges),
          serviceChargeAmount: numberValue(shift.serviceChargeAmount),
          roundOff: numberValue(shift.roundOff),
          expensesAmtTotal: numberValue(shift.expensesAmtTotal),
          expCash: numberValue(shift.expCash),
          expDigital: numberValue(shift.expDigital),
          advanceAmtTotal: numberValue(shift.advanceAmtTotal),
          customerReceiveAmtTotal: numberValue(shift.customerReceiveAmtTotal),
          receiveAmtTotal: numberValue(shift.receiveAmtTotal),
          swiggyTotal: numberValue(shift.swiggyTotal),
          zomatoTotal: numberValue(shift.zomatoTotal),
          payments: parsePayment(shift.paymentJson)
        };
      })
      .filter(shift => Number.isNaN(shiftNo) || shift.shiftNo === shiftNo)
      .filter(shift => !deviceId || shift.deviceId.toLowerCase().includes(deviceId))
      .sort((left, right) => right.dayId.localeCompare(left.dayId) || right.shiftNo - left.shiftNo);

    const summary = shifts.reduce((totals, shift) => {
      totals.totalBills += shift.billCount;
      totals.totalSale += shift.totalSale;
      totals.cashSale += shift.cashSale;
      totals.digitalSale += shift.digitalSale;
      totals.creditSale += shift.creditSale;
      totals.expenses += shift.expensesAmtTotal;
      return totals;
    }, { totalShifts: shifts.length, totalBills: 0, totalSale: 0, cashSale: 0, digitalSale: 0, creditSale: 0, expenses: 0 });

    res.json({ success: true, data: { shifts, summary } });
  } catch (error) {
    console.error("Loading shift summary report failed:", error);
    res.status(503).json({ success: false, message: "Unable to load the shift summary report right now" });
  }
});

// Category Endpoints (CRUD)
// 1. List all categories
app.get("/api/categories", (_req: Request, res: Response): void => {
  res.json({
    success: true,
    data: categories
  });
});

// 2. Create new category
app.post("/api/categories", (req: Request, res: Response): void => {
  const { code, name, description, status, color } = req.body;

  if (!name || typeof name !== "string" || !name.trim()) {
    res.status(400).json({
      success: false,
      message: "Category name is required"
    });
    return;
  }

  const newCategory: CategoryItem = {
    id: `cat_${Date.now()}`,
    code: (code && code.trim()) || `CAT-${(categories.length + 1).toString().padStart(3, "0")}`,
    name: name.trim(),
    description: description?.trim() || "",
    status: status === "Inactive" ? "Inactive" : "Active",
    productCount: 0,
    color: color || "#3567f0",
    createdAt: new Date().toISOString().split("T")[0] || "2024-09-18"
  };

  categories = [newCategory, ...categories];

  res.status(201).json({
    success: true,
    message: "Category created successfully",
    data: newCategory
  });
});

// 3. Update category
app.put("/api/categories/:id", (req: Request, res: Response): void => {
  const { id } = req.params;
  const { code, name, description, status, color } = req.body;

  const categoryIndex = categories.findIndex(c => c.id === id);
  if (categoryIndex === -1) {
    res.status(404).json({
      success: false,
      message: `Category with ID ${id} not found`
    });
    return;
  }

  const existing = categories[categoryIndex];
  if (!existing) {
    res.status(404).json({ success: false, message: "Category not found" });
    return;
  }

  const updated: CategoryItem = {
    ...existing,
    code: code ? code.trim() : existing.code,
    name: name ? name.trim() : existing.name,
    description: description !== undefined ? description.trim() : existing.description,
    status: status ? status : existing.status,
    color: color ? color : existing.color
  };

  categories[categoryIndex] = updated;

  res.json({
    success: true,
    message: "Category updated successfully",
    data: updated
  });
});

// 4. Delete category
app.delete("/api/categories/:id", (req: Request, res: Response): void => {
  const { id } = req.params;

  const initialLength = categories.length;
  categories = categories.filter(c => c.id !== id);

  if (categories.length === initialLength) {
    res.status(404).json({
      success: false,
      message: `Category with ID ${id} not found`
    });
    return;
  }

  res.json({
    success: true,
    message: "Category deleted successfully"
  });
});

app.listen(PORT, () => {
  console.log(`Web POS API running on http://localhost:${PORT}`);
  try {
    getFirebaseApp();
  } catch (error) {
    console.error("Firebase configuration error:", error instanceof Error ? error.message : error);
  }
});
