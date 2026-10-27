"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const webUsageMiddleware_js_1 = require("./webUsageMiddleware.js");
const dailyUsage_js_1 = require("./dailyUsage.js");
const multicounter_js_1 = require("./multicounter.js");
const productImageAuthorization_js_1 = require("./productImageAuthorization.js");
const transferPreviewPin_js_1 = require("./transferPreviewPin.js");
const masterTransfer_js_1 = require("./masterTransfer.js");
const devices_js_1 = require("./devices.js");
const customers_js_1 = require("./customers.js");
const employees_js_1 = require("./employees.js");
const userAccount_js_1 = require("./userAccount.js");
const productUpdate_js_1 = require("./productUpdate.js");
const stockAdjustment_js_1 = require("./stockAdjustment.js");
const productImageAssignments_js_1 = require("./productImageAssignments.js");
const premises_js_1 = require("./premises.js");
const androidTaxes_js_1 = require("../../shared/androidTaxes.js");
const premisesFirestore_js_1 = require("./premisesFirestore.js");
const firebase_js_1 = require("./firebase.js");
const categoryUpdate_js_1 = require("./categoryUpdate.js");
const outletDeletion_js_1 = require("./outletDeletion.js");
const productCreation_js_1 = require("./productCreation.js");
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const node_url_1 = require("node:url");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const zod_1 = require("zod");
const firebase_js_2 = require("./firebase.js");
const imageStorage_js_1 = require("./imageStorage.js");
const daywiseSummary_js_1 = require("./daywiseSummary.js");
const stockMovementReport_js_1 = require("./stockMovementReport.js");
const stockTransferReport_js_1 = require("./stockTransferReport.js");
const productImportValidation_js_1 = require("./productImportValidation.js");
const productImportWriter_js_1 = require("./productImportWriter.js");
const productImportQuota_js_1 = require("./productImportQuota.js");
const productImportQuotaFile_js_1 = require("./productImportQuotaFile.js");
dotenv_1.default.config({ path: (0, node_url_1.fileURLToPath)(new URL("../.env", import.meta.url)) });
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3000;
// Shared local history survives backend/PC restarts; no database quota records.
const productImportQuota = (0, productImportQuotaFile_js_1.createFileProductImportQuota)((0, node_url_1.fileURLToPath)(new URL("../.local-data/product-import-quota.json", import.meta.url)));
const JWT_SECRET = process.env.JWT_SECRET || "web-pos-secret-key-2026";
// Separate grants from login sessions; changing this key does not invalidate existing logins.
// This server-only signing key protects grants; users enter their existing login Quick PIN.
const IMAGE_JWT_SECRET = process.env.PRODUCT_IMAGE_SECRET || process.env.JWT_SECRET || '';
const TRANSFER_JWT_SECRET = process.env.MASTER_TRANSFER_SECRET || process.env.JWT_SECRET || '';
app.use((0, cors_1.default)());
app.use("/api/outlets/:outletId/products/import", express_1.default.json({ limit: "12mb" }));
app.use('/api/outlets/:outletId/product-image-assignments', express_1.default.json({ limit: '800kb' }));
app.use(express_1.default.json());
// All outlet-scoped routes in this Express backend belong to Web POS.
// Checks never renew leases; dashboard polling therefore cannot keep a session active.
app.use('/api/outlets/:outletId', (0, webUsageMiddleware_js_1.createWebUsageGuard)({ readToken: readAccessToken,
    db: firebase_js_2.getFirestoreDb, assigned: assignedOutletIds, operate: dailyUsage_js_1.operateOutletDailyUsage }));
let categories = [
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
app.get("/api/health", (_req, res) => {
    let firebase;
    try {
        const firebaseApp = (0, firebase_js_2.getFirebaseApp)();
        firebase = { initialized: true, projectId: firebaseApp.options.projectId ?? "" };
    }
    catch (error) {
        firebase = {
            initialized: false,
            // Only our fixed configuration messages are safe to return; never return SDK/parser errors.
            message: error instanceof firebase_js_2.FirebaseConfigurationError ? error.message
                : "Configure valid Firebase credentials and testing project isolation on the server"
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
app.get("/api/firebase/health", async (_req, res) => {
    try {
        await (0, firebase_js_2.verifyFirebaseConnection)();
        res.json({
            success: true,
            message: "Firebase is connected",
            projectId: (0, firebase_js_2.getFirebaseApp)().options.projectId
        });
    }
    catch (error) {
        (0, firebase_js_2.logFirebaseConfigurationError)(error, "connection");
        res.status(503).json({
            success: false,
            message: "Firebase connection failed"
        });
    }
});
const loginSchema = zod_1.z.object({
    email: zod_1.z.string().trim().email(),
    quickPin: zod_1.z.string().trim().regex(/^\d{4,6}$/),
    terminal: zod_1.z.string().trim().max(100).optional()
});
function profileRole(value) {
    const role = typeof value === "string" ? value.trim() : "";
    if (!role)
        return "User";
    return role
        .toLowerCase()
        .replace(/\b\w/g, character => character.toUpperCase());
}
// Authenticates an active USER_PROFILE using its email and quickPin fields.
app.post("/api/auth/login", async (req, res) => {
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
        (0, firebase_js_2.getFirebaseApp)();
    }
    catch (error) {
        (0, firebase_js_2.logFirebaseConfigurationError)(error, "login");
        res.status(503).json({
            success: false,
            message: error instanceof firebase_js_2.FirebaseConfigurationError ? error.message
                : "Firebase credentials or testing isolation are missing or invalid. Check the server configuration."
        });
        return;
    }
    try {
        const snapshot = await (0, firebase_js_2.getFirestoreDb)()
            .collection("USER_PROFILE")
            .where("email", "==", email.toLowerCase())
            .get();
        const document = snapshot.docs.find(candidate => String(candidate.data().quickPin ?? "") === quickPin);
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
        const token = jsonwebtoken_1.default.sign({ userId, profileDocId: document.id, email, name, role, terminal }, JWT_SECRET, { expiresIn: "12h" });
        res.json({
            success: true,
            message: `Authentication successful for ${name}`,
            data: {
                token,
                user: { id: userId, email, name, role, terminal }
            }
        });
    }
    catch (error) {
        console.error("Firestore login failed:", error);
        res.status(503).json({
            success: false,
            message: "Login service is temporarily unavailable"
        });
    }
});
function readAccessToken(req) {
    const authorization = req.header("authorization");
    if (!authorization?.startsWith("Bearer "))
        return null;
    try {
        const payload = jsonwebtoken_1.default.verify(authorization.slice(7), JWT_SECRET);
        if (typeof payload === "string" || typeof payload.profileDocId !== "string")
            return null;
        return payload;
    }
    catch {
        return null;
    }
}
// Current account access always targets the signed session's existing profile document.
app.get("/api/auth/account", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const token = readAccessToken(req);
    if (!token) {
        res.status(401).json({ success: false, message: "Your session has expired. Please sign in again." });
        return;
    }
    try {
        res.json({ success: true, data: await (0, userAccount_js_1.readUserAccount)((0, firebase_js_2.getFirestoreDb)(), token.profileDocId) });
    }
    catch (error) {
        res.status(error instanceof userAccount_js_1.UserAccountError ? error.status : 503).json({ success: false,
            message: error instanceof userAccount_js_1.UserAccountError ? error.message : "Unable to load your account details." });
    }
});
app.patch("/api/auth/account", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const token = readAccessToken(req);
    if (!token) {
        res.status(401).json({ success: false, message: "Your session has expired. Please sign in again." });
        return;
    }
    try {
        res.json({ success: true, data: await (0, userAccount_js_1.updateUserAccount)((0, firebase_js_2.getFirestoreDb)(), token.profileDocId, req.body) });
    }
    catch (error) {
        res.status(error instanceof userAccount_js_1.UserAccountError ? error.status : 503).json({ success: false,
            message: error instanceof userAccount_js_1.UserAccountError ? error.message : "Unable to save your account details." });
    }
});
function stringValue(value) {
    return typeof value === "string" ? value : "";
}
function numberValue(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
// Display metadata only: retain the historical rate without recalculating sales.
function historicalReportTaxRate(bill, item) {
    if ((stringValue(bill.taxType) || "NoTax").toLowerCase() === "notax")
        return 0;
    const rate = item.taxPercentage;
    return typeof rate === "number" && Number.isFinite(rate) && rate >= 0 ? rate : null;
}
function reportTaxRateLabel(rates) {
    const known = [...rates].filter((rate) => rate !== null);
    if (known.length > 1)
        return known.sort((a, b) => a - b).map(rate => `${rate}%`).join(", ");
    if (rates.has(null) || known.length === 0)
        return 0;
    return `${known[0]}%`;
}
function addReportTaxGroup(groups, bill, item, productId) {
    const rate = historicalReportTaxRate(bill, item);
    const lineTotal = numberValue(item.total);
    const taxType = (stringValue(bill.taxType) || "NoTax").toLowerCase();
    // Identical item-level formula to the existing GST report. Sale stays item.total.
    const taxAmount = rate === null || rate <= 0 ? 0
        : taxType === "inclusive" ? lineTotal - lineTotal / (1 + rate / 100)
            : lineTotal * rate / 100;
    const group = groups.get(rate) ?? {
        rate, quantity: 0, amount: 0, taxableValue: 0, taxAmount: 0, products: new Set(),
    };
    group.quantity += numberValue(item.quantity);
    group.amount += lineTotal;
    group.taxAmount += taxAmount;
    group.taxableValue += taxType === "inclusive" ? lineTotal - taxAmount : lineTotal;
    group.products.add(productId);
    groups.set(rate, group);
}
function reportTaxBreakdown(groups) {
    return [...groups.values()].sort((a, b) => (a.rate ?? Infinity) - (b.rate ?? Infinity))
        .map(({ products, ...group }) => ({ ...group, productCount: products.size }));
}
function reportTaxAmount(groups) {
    return [...groups.values()].reduce((sum, group) => sum + group.taxAmount, 0);
}
function assignedOutletIds(profile) {
    const assignedIds = [
        ...(Array.isArray(profile.outlets) ? profile.outlets : []),
        ...(Array.isArray(profile.outletList) ? profile.outletList : []),
        profile.outletId
    ].filter((value) => typeof value === "string" && value.length > 0);
    return [...new Set(assignedIds)];
}
// Returns only OUTLET documents assigned to the authenticated USER_PROFILE.
app.get("/api/auth/outlets", async (req, res) => {
    const token = readAccessToken(req);
    if (!token) {
        res.status(401).json({ success: false, message: "Your session has expired. Please sign in again." });
        return;
    }
    try {
        const db = (0, firebase_js_2.getFirestoreDb)();
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
        const documents = await db.getAll(...outletIds.map(outletId => db.collection("OUTLET").doc(outletId)));
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
    }
    catch (error) {
        console.error("Loading user outlets failed:", error);
        res.status(503).json({ success: false, message: "Unable to load outlets right now" });
    }
});
// Loads the selected outlet's shift summary for the requested business day.
// Display-only account details for the authenticated user and an assigned outlet.
app.get("/api/outlets/:outletId/profile", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const token = readAccessToken(req);
    const parameter = req.params.outletId;
    const outletId = Array.isArray(parameter) ? parameter[0] ?? "" : parameter ?? "";
    try {
        if (!token)
            throw new productCreation_js_1.ProductCreationError(401, "Your session has expired. Please sign in again.");
        const db = (0, firebase_js_2.getFirestoreDb)();
        const profile = (await db.collection("USER_PROFILE").doc(token.profileDocId).get()).data();
        (0, productCreation_js_1.requireProductOutlet)(token.profileDocId, outletId, profile, assignedOutletIds);
        const outlet = await db.collection("OUTLET").doc(outletId).get();
        if (!outlet.exists)
            throw new productCreation_js_1.ProductCreationError(404, "Outlet not found.");
        res.json({ success: true, data: {
                name: stringValue(profile.name), mobile: stringValue(profile.mobile),
                role: profileRole(profile.roll), outletName: stringValue(outlet.data()?.name),
            } });
    }
    catch (error) {
        res.status(error instanceof productCreation_js_1.ProductCreationError ? error.status : 503).json({ success: false,
            message: error instanceof productCreation_js_1.ProductCreationError ? error.message : "Unable to load your account details." });
    }
});
app.get("/api/outlets/:outletId/dashboard", async (req, res) => {
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
        const db = (0, firebase_js_2.getFirestoreDb)();
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
        if (shiftSnapshot.empty) {
            res.status(404).json({ success: false, message: `No shift data found for ${requestedDay}` });
            return;
        }
        const formatShiftData = (docId, shift) => {
            const payments = shift.payments && typeof shift.payments === "object" && !Array.isArray(shift.payments)
                ? Object.fromEntries(Object.entries(shift.payments).map(([key, val]) => [key, numberValue(val)]))
                : parsePayment(shift.paymentJson);
            return {
                id: docId,
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
                payments
            };
        };
        const formattedShifts = shiftSnapshot.docs
            .map(doc => formatShiftData(doc.id, doc.data()))
            .sort((left, right) => (left.startTime - right.startTime) || (left.shiftNo - right.shiftNo) || left.id.localeCompare(right.id));
        const daySummaryRaw = (0, daywiseSummary_js_1.summarizeDay)(shiftSnapshot.docs.map(doc => doc.data()));
        const latestDoc = [...shiftSnapshot.docs].sort((left, right) => numberValue(right.data().shiftNo) - numberValue(left.data().shiftNo))[0];
        const overallSummary = formatShiftData(latestDoc?.id ?? formattedShifts[0]?.id ?? "", daySummaryRaw);
        const shiftParam = typeof req.query.shiftNo === "string" ? Number.parseInt(req.query.shiftNo, 10) : Number.NaN;
        const shiftIdParam = typeof req.query.shiftId === "string" ? req.query.shiftId.trim().toLowerCase() : "";
        let selectedData = overallSummary;
        if (!Number.isNaN(shiftParam)) {
            const found = formattedShifts.find(s => s.shiftNo === shiftParam);
            if (found)
                selectedData = found;
        }
        else if (shiftIdParam) {
            const found = formattedShifts.find(s => s.id.toLowerCase() === shiftIdParam);
            if (found)
                selectedData = found;
        }
        else if (req.query.scope === "shift") {
            selectedData = formattedShifts.at(-1) ?? overallSummary;
        }
        res.json({
            success: true,
            data: {
                ...selectedData,
                shifts: formattedShifts
            }
        });
    }
    catch (error) {
        console.error("Loading outlet dashboard failed:", error);
        res.status(503).json({ success: false, message: "Unable to load shift data right now" });
    }
});
function datesBetween(startDate, endDate) {
    const dates = [];
    const cursor = new Date(`${startDate}T00:00:00Z`);
    const end = new Date(`${endDate}T00:00:00Z`);
    while (cursor <= end && dates.length < 31) {
        dates.push(cursor.toISOString().slice(0, 10));
        cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return dates;
}
function parsePayment(value) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
        return Object.fromEntries(Object.entries(value).map(([key, amount]) => [key, numberValue(amount)]));
    }
    if (typeof value !== "string")
        return {};
    try {
        const parsed = JSON.parse(value);
        return Object.fromEntries(Object.entries(parsed).map(([key, amount]) => [key, numberValue(amount)]));
    }
    catch {
        return {};
    }
}
// Read-only goods transactions explicitly marked as stock transfers, scoped to an assigned outlet.
app.get("/api/outlets/:outletId/reports/stock-transfers", async (req, res) => {
    const token = readAccessToken(req);
    if (!token) {
        res.status(401).json({ success: false, message: "Your session has expired. Please sign in again." });
        return;
    }
    const outletParam = req.params.outletId;
    const outletId = Array.isArray(outletParam) ? outletParam[0] : outletParam;
    const startDate = typeof req.query.startDate === "string" ? req.query.startDate : "";
    const endDate = typeof req.query.endDate === "string" ? req.query.endDate : startDate;
    const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value)
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
        const db = (0, firebase_js_2.getFirestoreDb)();
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
            .filter(document => (0, stockTransferReport_js_1.isStockTransfer)(document.data()))
            .map(document => (0, stockTransferReport_js_1.stockTransferRecord)(document.id, document.data()))
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
    }
    catch (error) {
        console.error("Loading stock transfer report failed:", error);
        res.status(503).json({ success: false, message: "Unable to load stock transfers right now" });
    }
});
// Read-only explicit STOCK-IN and STOCK-OUT transactions for an assigned outlet.
app.get("/api/outlets/:outletId/reports/stock-movements", async (req, res) => {
    const token = readAccessToken(req);
    if (!token) {
        res.status(401).json({ success: false, message: "Your session has expired. Please sign in again." });
        return;
    }
    const outletParam = req.params.outletId;
    const outletId = Array.isArray(outletParam) ? outletParam[0] : outletParam;
    const startDate = typeof req.query.startDate === "string" ? req.query.startDate : "";
    const endDate = typeof req.query.endDate === "string" ? req.query.endDate : startDate;
    const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value)
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
        const db = (0, firebase_js_2.getFirestoreDb)();
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
            .filter(document => (0, stockMovementReport_js_1.stockDirection)(document.data()) !== null)
            .map(document => (0, stockMovementReport_js_1.stockMovementRecord)(document.id, document.data()))
            .filter(entry => !direction || entry.direction === direction)
            .filter(entry => !search || [entry.transactionNo, entry.supplier, entry.remark,
            ...entry.items.flatMap(item => [item.name, item.productId])]
            .some(value => value.toLowerCase().includes(search)))
            .sort((left, right) => right.createdDate - left.createdDate);
        const summary = movements.reduce((totals, entry) => {
            const quantity = Math.abs(entry.quantity);
            if (entry.direction === "in")
                totals.stockInQuantity += quantity;
            else
                totals.stockOutQuantity += quantity;
            totals.totalAmount += entry.finalTotal;
            return totals;
        }, { totalTransactions: movements.length, stockInQuantity: 0, stockOutQuantity: 0, totalAmount: 0 });
        res.json({ success: true, data: {
                movements,
                summary: { ...summary, netQuantity: summary.stockInQuantity - summary.stockOutQuantity },
            } });
    }
    catch (error) {
        console.error("Loading stock in-out report failed:", error);
        res.status(503).json({ success: false, message: "Unable to load stock movements right now" });
    }
});
// Bill-wise sales report scoped to an outlet assigned to the authenticated user.
app.get("/api/outlets/:outletId/reports/bills", async (req, res) => {
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
        const db = (0, firebase_js_2.getFirestoreDb)();
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
            const items = Array.isArray(bill.billSaleItems) ? bill.billSaleItems.map((rawItem) => {
                const item = rawItem && typeof rawItem === "object" ? rawItem : {};
                const product = item.product && typeof item.product === "object"
                    ? item.product
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
    }
    catch (error) {
        console.error("Loading bill-wise report failed:", error);
        res.status(503).json({ success: false, message: "Unable to load the bill-wise report right now" });
    }
});
// Category-wise sales report: aggregates billed items by product category, scoped to an assigned outlet.
app.get("/api/outlets/:outletId/reports/categories", async (req, res) => {
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
        const db = (0, firebase_js_2.getFirestoreDb)();
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
            return [document.id, typeof value === "number" && Number.isFinite(value) ? value : null];
        }));
        const categories = new Map();
        const allBills = new Set();
        for (const document of billSnapshots.flatMap(snapshot => snapshot.docs)) {
            const bill = document.data();
            if (shiftId && !stringValue(bill.shiftId).toLowerCase().includes(shiftId))
                continue;
            const items = Array.isArray(bill.billSaleItems) ? bill.billSaleItems : [];
            for (const rawItem of items) {
                const item = rawItem && typeof rawItem === "object" ? rawItem : {};
                if (item.deleted === true)
                    continue;
                const product = item.product && typeof item.product === "object" ? item.product : {};
                const categoryId = stringValue(product.category);
                const categoryName = categoryNames.get(categoryId) || (categoryId ? "Unknown category" : "Uncategorized");
                if (search && !categoryName.toLowerCase().includes(search))
                    continue;
                const key = categoryId || "uncategorized";
                const totals = categories.get(key) ?? {
                    categoryId: key, name: categoryName, quantity: 0, amount: 0, bills: new Set(), products: new Map(), taxRates: new Set(), taxGroups: new Map()
                };
                const productName = stringValue(product.name) || stringValue(product.shortName) || "Item";
                const productId = stringValue(product.id) || productName;
                const productTotals = totals.products.get(productId) ?? { productId, name: productName, quantity: 0, amount: 0, taxRates: new Set(), taxGroups: new Map() };
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
    }
    catch (error) {
        console.error("Loading category-wise report failed:", error);
        res.status(503).json({ success: false, message: "Unable to load the category-wise report right now" });
    }
});
// Read-only category master for an assigned outlet.
app.get("/api/outlets/:outletId/categories", async (req, res) => {
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
        const db = (0, firebase_js_2.getFirestoreDb)();
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
        const productCounts = new Map();
        for (const document of productSnapshot.docs) {
            const categoryId = stringValue(document.data().category);
            if (categoryId)
                productCounts.set(categoryId, (productCounts.get(categoryId) ?? 0) + 1);
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
                createdAt: document.createTime?.toDate().toISOString() ?? "",
                ...(typeof category.imagePath === 'string' ? { imagePath: category.imagePath } : {})
            };
        })
            .sort((left, right) => (left.categoryNo ?? 0) - (right.categoryNo ?? 0) || left.name.localeCompare(right.name));
        res.json({ success: true, data: categories });
    }
    catch (error) {
        console.error("Loading outlet categories failed:", error);
        res.status(503).json({ success: false, message: "Unable to load categories right now" });
    }
});
const imageBodyParser = (req, res, next) => {
    express_1.default.raw({ type: () => true, limit: '5mb' })(req, res, error => {
        if (!error) {
            next();
            return;
        }
        const status = error.status === 413 ? 413 : 400;
        res.status(status).json({ success: false, message: status === 413 ? 'Images must be 5 MB or smaller.' : 'The image upload could not be read.' });
    });
};
async function authorizeImageTarget(req, res, collection) {
    const token = readAccessToken(req);
    if (!token) {
        res.status(401).json({ success: false, message: 'Your session has expired. Please sign in again.' });
        return null;
    }
    const outletId = String(req.params.outletId ?? '');
    const documentId = String(req.params.documentId ?? '');
    if (![outletId, documentId].every(id => id && id.length <= 200 && !id.includes('/') && id !== '.' && id !== '..')) {
        res.status(400).json({ success: false, message: 'A valid outlet and record ID are required.' });
        return null;
    }
    try {
        const db = (0, firebase_js_2.getFirestoreDb)();
        const profile = (await db.collection('USER_PROFILE').doc(token.profileDocId).get()).data();
        (0, productCreation_js_1.requireProductOutlet)(token.profileDocId, outletId, profile, assignedOutletIds);
        const document = db.collection('OUTLET').doc(outletId).collection(collection).doc(documentId);
        const snapshot = await document.get();
        if (!snapshot.exists) {
            res.status(404).json({ success: false, message: 'This record no longer exists.' });
            return null;
        }
        return { db, outletId, documentId, profileId: token.profileDocId, snapshot };
    }
    catch (error) {
        const status = error instanceof productCreation_js_1.ProductCreationError ? error.status : 503;
        res.status(status).json({ success: false, message: error instanceof productCreation_js_1.ProductCreationError
                ? error.message : 'Image service is unavailable.' });
        return null;
    }
}
function imageApiError(res, error) {
    if (error instanceof productCreation_js_1.ProductCreationError) {
        res.status(error.status).json({ success: false, message: error.message });
        return;
    }
    if (error instanceof imageStorage_js_1.ImageStorageError) {
        res.status(error.status).json({ success: false, message: error.message });
        return;
    }
    if (error instanceof firebase_js_2.FirebaseConfigurationError) {
        const message = error.check === 'missing_storage_bucket'
            ? 'Firebase Storage bucket is not configured in the running backend. Restart the backend after setting FIREBASE_STORAGE_BUCKET.'
            : 'Firebase Storage configuration is invalid. Check the backend Firebase configuration.';
        res.status(503).json({ success: false, message });
        return;
    }
    const code = error && typeof error === 'object' && 'code' in error
        ? error.code : undefined;
    const safeCode = typeof code === 'number' || (typeof code === 'string' && /^[A-Z0-9_/-]{1,40}$/i.test(code))
        ? code : 'unknown';
    console.error('Firebase image operation failed', { code: safeCode });
    const message = safeCode === 403
        ? 'Firebase Storage denied access. Check the backend service account permissions for this bucket.'
        : safeCode === 404
            ? 'The configured Firebase Storage bucket was not found. Check FIREBASE_STORAGE_BUCKET.'
            : 'Firebase Storage could not complete the request. Check the backend logs and bucket configuration.';
    res.status(503).json({ success: false, message });
}
app.post('/api/outlets/:outletId/product-images/verify-quick-pin', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const token = readAccessToken(req);
    if (!token) {
        res.status(401).json({ success: false, message: 'Your session has expired. Please sign in again.' });
        return;
    }
    try {
        const data = await (0, productImageAuthorization_js_1.verifyProductImagePin)((0, firebase_js_2.getFirestoreDb)(), String(req.params.outletId ?? ''), token.profileDocId, assignedOutletIds, IMAGE_JWT_SECRET, req.header('authorization') ?? '', req.body);
        res.json({ success: true, data });
    }
    catch (error) {
        res.status(error instanceof productCreation_js_1.ProductCreationError ? error.status : 503).json({ success: false,
            message: error instanceof productCreation_js_1.ProductCreationError ? error.message : 'Unable to verify your Quick PIN. Please try again.' });
    }
});
app.post('/api/outlets/:outletId/product-image-assignments', async (req, res) => {
    const token = readAccessToken(req);
    if (!token) {
        res.status(401).json({ success: false, message: 'Your session has expired. Please sign in again.' });
        return;
    }
    try {
        (0, productImageAuthorization_js_1.requireProductImageAuthorization)(IMAGE_JWT_SECRET, req.header('x-image-token'), token.profileDocId, String(req.params.outletId ?? ''), req.header('authorization') ?? '', ['bulk', 'shared']);
        const data = await (0, productImageAssignments_js_1.assignProductImage)((0, firebase_js_2.getFirestoreDb)(), (0, firebase_js_2.getFirebaseStorageBucket)(), String(req.params.outletId ?? ''), token.profileDocId, assignedOutletIds, req.body);
        res.json({ success: true, data });
    }
    catch (error) {
        if (error instanceof productCreation_js_1.ProductCreationError) {
            res.status(error.status).json({ success: false, message: error.message });
            return;
        }
        imageApiError(res, error);
    }
});
// Bulk removal has its own route so omitting a review cannot bypass the PIN gate.
app.delete('/api/outlets/:outletId/product-image-removals/:documentId', async (req, res) => {
    const target = await authorizeImageTarget(req, res, 'PRODUCT');
    if (!target)
        return;
    try {
        (0, productImageAuthorization_js_1.requireProductImageAuthorization)(IMAGE_JWT_SECRET, req.header('x-image-token'), target.profileId, target.outletId, req.header('authorization') ?? '', ['remove']);
        if (!req.body)
            throw new imageStorage_js_1.ImageStorageError(400, 'The reviewed image references are required.');
        const data = await (0, imageStorage_js_1.removeMasterImage)(target.db, 'products', target.outletId, target.documentId, req.body);
        res.json({ success: true, data });
    }
    catch (error) {
        imageApiError(res, error);
    }
});
for (const [routeCollection, firestoreCollection] of [['products', 'PRODUCT'], ['categories', 'CATEGORY']]) {
    const imagePath = `/api/outlets/:outletId/${routeCollection}/:documentId/image`;
    const imageKind = routeCollection;
    app.put(imagePath, imageBodyParser, async (req, res) => {
        const target = await authorizeImageTarget(req, res, firestoreCollection);
        if (!target)
            return;
        try {
            const declaredType = String(req.header('content-type') ?? '').split(';', 1)[0].trim().toLowerCase();
            const requestId = req.header('X-Image-Upload-Id');
            let operation;
            if (requestId && imageKind === 'products') {
                let expectedReference;
                try {
                    expectedReference = JSON.parse(req.header('X-Image-Expected-Reference') ?? '');
                }
                catch {
                    throw new imageStorage_js_1.ImageStorageError(400, 'The reviewed image reference is missing or invalid.');
                }
                if (expectedReference !== null && typeof expectedReference !== 'string')
                    throw new imageStorage_js_1.ImageStorageError(400, 'Invalid reviewed image reference.');
                operation = { requestId, expectedReference };
            }
            const data = await (0, imageStorage_js_1.uploadMasterImage)(target.db, (0, firebase_js_2.getFirebaseStorageBucket)(), imageKind, target.outletId, target.documentId, Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), declaredType, operation);
            res.json({ success: true, data });
        }
        catch (error) {
            imageApiError(res, error);
        }
    });
    app.get(imagePath, async (req, res) => {
        const target = await authorizeImageTarget(req, res, firestoreCollection);
        if (!target)
            return;
        try {
            const image = await (0, imageStorage_js_1.readMasterImage)(target.db, (0, firebase_js_2.getFirebaseStorageBucket)(), imageKind, target.outletId, target.documentId, target.snapshot);
            res.setHeader('Cache-Control', 'private, no-store');
            res.setHeader('X-Content-Type-Options', 'nosniff');
            res.setHeader('Content-Type', image.contentType);
            res.send(image.bytes);
        }
        catch (error) {
            imageApiError(res, error);
        }
    });
    app.delete(imagePath, async (req, res) => {
        const target = await authorizeImageTarget(req, res, firestoreCollection);
        if (!target)
            return;
        try {
            const data = await (0, imageStorage_js_1.removeMasterImage)(target.db, imageKind, target.outletId, target.documentId, imageKind === 'products' ? req.body : undefined);
            res.json({ success: true, data });
        }
        catch (error) {
            imageApiError(res, error);
        }
    });
}
// Explicit Web POS storage initialization only. This does not start accounting or enforce login limits.
app.post('/api/outlets/:outletId/usage/initialize', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const token = readAccessToken(req);
    if (!token) {
        res.status(401).json({ success: false, message: 'Your session has expired. Please sign in again.' });
        return;
    }
    try {
        const data = await (0, dailyUsage_js_1.initializeOutletDailyUsage)((0, firebase_js_2.getFirestoreDb)(), String(req.params.outletId ?? ''), token.profileDocId, assignedOutletIds, req.body ?? {});
        res.json({ success: true, data });
    }
    catch (error) {
        res.status(error instanceof productCreation_js_1.ProductCreationError ? error.status : 503).json({ success: false,
            message: error instanceof productCreation_js_1.ProductCreationError ? error.message : 'Unable to initialize daily usage. Please try again.' });
    }
});
// Explicit Web POS lifecycle only. JWT login remains available for outlet selection/recovery.
app.post('/api/outlets/:outletId/usage/:action', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const token = readAccessToken(req);
    if (!token) {
        res.status(401).json({ success: false, message: 'Your session has expired. Please sign in again.' });
        return;
    }
    try {
        const body = req.body ?? {};
        if (!body || typeof body !== 'object' || Array.isArray(body) || 'action' in body)
            throw new dailyUsage_js_1.DailyUsageError(422, 'USAGE_INVALID_REQUEST', 'Invalid usage request.');
        if (!['start', 'heartbeat', 'stop', 'status'].includes(String(req.params.action)))
            throw new dailyUsage_js_1.DailyUsageError(404, 'USAGE_INVALID_REQUEST', 'Unknown usage action.');
        const data = await (0, dailyUsage_js_1.operateOutletDailyUsage)((0, firebase_js_2.getFirestoreDb)(), String(req.params.outletId ?? ''), token.profileDocId, assignedOutletIds, { ...body, action: String(req.params.action) });
        res.json({ success: true, data });
    }
    catch (error) {
        res.status(error instanceof productCreation_js_1.ProductCreationError ? error.status : 503).json({ success: false,
            code: error instanceof dailyUsage_js_1.DailyUsageError ? error.code : 'USAGE_UNAVAILABLE',
            message: error instanceof productCreation_js_1.ProductCreationError ? error.message : 'Unable to verify Web POS usage. Access has not been granted.' });
    }
});
// Credential verification uses POST to keep the PIN out of URLs. This handler only reads records.
app.post('/api/outlets/:outletId/transfer-preview/verify-quick-pin', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const token = readAccessToken(req);
    if (!token) {
        res.status(401).json({ success: false, message: 'Your session has expired. Please sign in again.' });
        return;
    }
    try {
        const data = await (0, transferPreviewPin_js_1.verifyTransferPreviewPin)((0, firebase_js_2.getFirestoreDb)(), String(req.params.outletId ?? ''), token.profileDocId, assignedOutletIds, req.body);
        res.json({ success: true, data: { ...data, transferToken: (0, masterTransfer_js_1.issueTransferAuthorization)(TRANSFER_JWT_SECRET, token.profileDocId, String(req.params.outletId ?? ''), data.destinationOutletId) } });
    }
    catch (error) {
        res.status(error instanceof productCreation_js_1.ProductCreationError ? error.status : 503).json({ success: false,
            message: error instanceof productCreation_js_1.ProductCreationError ? error.message : 'Unable to verify your QuickPin. Please try again.' });
    }
});
// Create-only copies, authorized for both outlets by the short-lived QuickPin grant.
app.post('/api/outlets/:outletId/master-transfer', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const token = readAccessToken(req);
    if (!token) {
        res.status(401).json({ success: false, message: 'Your session has expired. Please sign in again.' });
        return;
    }
    try {
        const data = await (0, masterTransfer_js_1.transferOutletMasters)((0, firebase_js_2.getFirestoreDb)(), String(req.params.outletId ?? ''), token.profileDocId, assignedOutletIds, TRANSFER_JWT_SECRET, req.header('x-transfer-token'), req.body);
        res.json({ success: true, data });
    }
    catch (error) {
        res.status(error instanceof productCreation_js_1.ProductCreationError ? error.status : 503).json({ success: false,
            message: error instanceof productCreation_js_1.ProductCreationError ? error.message : 'Transfer could not be confirmed. Retry the same selection safely; existing copies will not be duplicated.' });
    }
});
// Existing outlet multicounter configuration only. Never infer configured counters from devices.
app.get("/api/outlets/:outletId/multicounter", async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const token = readAccessToken(req);
    if (!token) {
        res.status(401).json({ success: false, message: 'Your session has expired. Please sign in again.' });
        return;
    }
    try {
        const data = await (0, multicounter_js_1.readOutletMulticounter)((0, firebase_js_2.getFirestoreDb)(), String(req.params.outletId ?? ''), token.profileDocId, assignedOutletIds);
        res.json({ success: true, data });
    }
    catch (error) {
        res.status(error instanceof productCreation_js_1.ProductCreationError ? error.status : 503).json({ success: false,
            message: error instanceof productCreation_js_1.ProductCreationError ? error.message : 'Unable to load multicounter configuration. Please try again.' });
    }
});
// Display existing device status only; registration/activation behavior is unchanged.
app.get("/api/outlets/:outletId/devices", async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const token = readAccessToken(req);
    if (!token) {
        res.status(401).json({ success: false, message: 'Your session has expired. Please sign in again.' });
        return;
    }
    try {
        const data = await (0, devices_js_1.listOutletDevices)((0, firebase_js_2.getFirestoreDb)(), String(req.params.outletId ?? ''), token.profileDocId, assignedOutletIds);
        res.json({ success: true, data });
    }
    catch (error) {
        res.status(error instanceof productCreation_js_1.ProductCreationError ? error.status : 503).json({ success: false,
            message: error instanceof productCreation_js_1.ProductCreationError ? error.message : 'Unable to load devices. Please try again.' });
    }
});
// Customer reads and creates are scoped to the signed-in user's assigned outlet.
app.get("/api/outlets/:outletId/customers", async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const token = readAccessToken(req);
    if (!token) {
        res.status(401).json({ success: false, message: 'Your session has expired. Please sign in again.' });
        return;
    }
    try {
        const data = await (0, customers_js_1.listOutletCustomers)((0, firebase_js_2.getFirestoreDb)(), String(req.params.outletId ?? ''), token.profileDocId, assignedOutletIds);
        res.json({ success: true, data });
    }
    catch (error) {
        res.status(error instanceof productCreation_js_1.ProductCreationError ? error.status : 503).json({ success: false,
            message: error instanceof productCreation_js_1.ProductCreationError ? error.message : 'Unable to load customers. Please try again.' });
    }
});
app.post("/api/outlets/:outletId/customers", async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const token = readAccessToken(req);
    if (!token) {
        res.status(401).json({ success: false, message: 'Your session has expired. Please sign in again.' });
        return;
    }
    try {
        const data = await (0, customers_js_1.createOutletCustomer)((0, firebase_js_2.getFirestoreDb)(), String(req.params.outletId ?? ''), token.profileDocId, assignedOutletIds, req.body);
        res.json({ success: true, data });
    }
    catch (error) {
        res.status(error instanceof productCreation_js_1.ProductCreationError ? error.status : 503).json({ success: false,
            message: error instanceof productCreation_js_1.ProductCreationError ? error.message : 'Unable to confirm the customer save. Retry without changing the form to confirm the outcome.' });
    }
});
// Reuse the Android outlet's employee pool for employee/captain/salesman selection.
app.get("/api/outlets/:outletId/employees", async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const token = readAccessToken(req);
    if (!token) {
        res.status(401).json({ success: false, message: 'Your session has expired. Please sign in again.' });
        return;
    }
    try {
        const data = await (0, employees_js_1.listOutletEmployees)((0, firebase_js_2.getFirestoreDb)(), String(req.params.outletId ?? ''), token.profileDocId, assignedOutletIds);
        res.json({ success: true, data });
    }
    catch (error) {
        res.status(error instanceof productCreation_js_1.ProductCreationError ? error.status : 503).json({ success: false,
            message: error instanceof productCreation_js_1.ProductCreationError ? error.message : 'Unable to load employees. Please try again.' });
    }
});
app.post("/api/outlets/:outletId/employees", async (req, res) => {
    const token = readAccessToken(req);
    if (!token) {
        res.status(401).json({ success: false, message: 'Your session has expired. Please sign in again.' });
        return;
    }
    try {
        const data = await (0, employees_js_1.createOutletEmployee)((0, firebase_js_2.getFirestoreDb)(), String(req.params.outletId ?? ''), token.profileDocId, assignedOutletIds, req.body);
        res.json({ success: true, data });
    }
    catch (error) {
        res.status(error instanceof productCreation_js_1.ProductCreationError ? error.status : 503).json({ success: false,
            message: error instanceof productCreation_js_1.ProductCreationError ? error.message : 'Unable to confirm the employee save. Retry without changing the form to confirm the outcome.' });
    }
});
app.get('/api/outlets/:outletId/premises', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const token = readAccessToken(req);
    if (!token) {
        res.status(401).json({ success: false, message: 'Your session has expired. Please sign in again.' });
        return;
    }
    try {
        const data = await (0, premises_js_1.listOutletPremises)((0, firebase_js_2.getFirestoreDb)(), String(req.params.outletId ?? ''), token.profileDocId, assignedOutletIds);
        res.json({ success: true, data });
    }
    catch (error) {
        res.status(error instanceof productCreation_js_1.ProductCreationError ? error.status : 503).json({ success: false,
            message: error instanceof productCreation_js_1.ProductCreationError ? error.message : 'Unable to load premises. Please try again.' });
    }
});
app.post('/api/outlets/:outletId/premises', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const token = readAccessToken(req);
    if (!token) {
        res.status(401).json({ success: false, message: 'Your session has expired. Please sign in again.' });
        return;
    }
    try {
        const context = (0, firebase_js_1.getFirestoreRestContext)();
        const data = await (0, premises_js_1.createOutletPremise)((0, premisesFirestore_js_1.premisesTransactionRunner)(context.database, context.accessToken), String(req.params.outletId ?? ''), token.profileDocId, assignedOutletIds, req.body);
        res.status(201).json({ success: true, data });
    }
    catch (error) {
        res.status(error instanceof productCreation_js_1.ProductCreationError ? error.status : 503).json({ success: false,
            message: error instanceof productCreation_js_1.ProductCreationError ? error.message : 'Unable to confirm the premises save. Retry the same form to confirm the outcome.' });
    }
});
app.patch('/api/outlets/:outletId/premises/:documentId', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const token = readAccessToken(req);
    if (!token) {
        res.status(401).json({ success: false, message: 'Your session has expired. Please sign in again.' });
        return;
    }
    try {
        const context = (0, firebase_js_1.getFirestoreRestContext)();
        const data = await (0, premises_js_1.updateOutletPremise)((0, premisesFirestore_js_1.premisesTransactionRunner)(context.database, context.accessToken), String(req.params.outletId ?? ''), String(req.params.documentId ?? ''), token.profileDocId, assignedOutletIds, req.body);
        res.json({ success: true, data });
    }
    catch (error) {
        res.status(error instanceof productCreation_js_1.ProductCreationError ? error.status : 503).json({ success: false,
            message: error instanceof productCreation_js_1.ProductCreationError ? error.message : 'Unable to confirm the premises update. Retry the same changes to confirm the outcome.' });
    }
});
// Read the complete product documents without renaming fields or writing to Firestore.
app.get("/api/outlets/:outletId/products", async (req, res) => {
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
        const db = (0, firebase_js_2.getFirestoreDb)();
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
    }
    catch (error) {
        console.error("Loading outlet products failed:", error);
        res.status(503).json({ success: false, message: "Unable to load products right now" });
    }
});
app.get("/api/outlets/:outletId/products/:documentId/edit-options", async (req, res) => {
    try {
        const token = readAccessToken(req);
        const outletId = String(req.params.outletId ?? '');
        const id = String(req.params.documentId ?? '');
        const deps = productImportDependencies();
        (0, productCreation_js_1.requireProductOutlet)(token?.profileDocId ?? null, outletId, token ? await deps.readProfile(token.profileDocId) : undefined, assignedOutletIds);
        if (!id || id.includes('/') || id === '.' || id === '..')
            throw new productCreation_js_1.ProductCreationError(400, 'A valid product ID is required.');
        const [snapshot, categories, premises] = await Promise.all([
            (0, firebase_js_2.getFirestoreDb)().collection('OUTLET').doc(outletId).collection('PRODUCT').doc(id).get(),
            deps.readCategories(outletId),
            deps.readPremises(outletId),
        ]);
        if (!snapshot.exists)
            throw new productCreation_js_1.ProductCreationError(404, 'This product no longer exists.');
        const fields = snapshot.data();
        res.json({ success: true, data: { code: typeof fields.code === 'string' || typeof fields.code === 'number' ? fields.code : '',
                categories, taxes: androidTaxes_js_1.ANDROID_TAX_OPTIONS, units: productCreation_js_1.PRODUCT_UNITS, premises, product: { documentId: id, fields } } });
    }
    catch (error) {
        productCreationResponse(res, error);
    }
});
app.post("/api/outlets/:outletId/stock-adjustments", async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const token = readAccessToken(req);
    if (!token) {
        res.status(401).json({ success: false, message: 'Your session has expired. Please sign in again.' });
        return;
    }
    try {
        const data = await (0, stockAdjustment_js_1.saveStockAdjustment)((0, firebase_js_2.getFirestoreDb)(), String(req.params.outletId ?? ''), token.profileDocId, assignedOutletIds, req.body);
        res.json({ success: true, data });
    }
    catch (error) {
        res.status(error instanceof productCreation_js_1.ProductCreationError ? error.status : 503).json({ success: false,
            message: error instanceof productCreation_js_1.ProductCreationError ? error.message : 'The stock save could not be confirmed. Retry the same confirmation to reconcile the outcome.' });
    }
});
app.patch("/api/outlets/:outletId/products/:documentId", async (req, res) => {
    try {
        const data = await (0, productUpdate_js_1.updateOutletProduct)((0, firebase_js_2.getFirestoreDb)(), String(req.params.outletId ?? ''), String(req.params.documentId ?? ''), readAccessToken(req)?.profileDocId ?? null, assignedOutletIds, req.body);
        res.json({ success: true, data });
    }
    catch (error) {
        productCreationResponse(res, error);
    }
});
app.patch("/api/outlets/:outletId/categories/:documentId", async (req, res) => {
    try {
        const data = await (0, categoryUpdate_js_1.updateCategoryNames)((0, firebase_js_2.getFirestoreDb)(), String(req.params.outletId ?? ''), String(req.params.documentId ?? ''), readAccessToken(req)?.profileDocId ?? null, assignedOutletIds, req.body);
        res.json({ success: true, data });
    }
    catch (error) {
        res.status(error instanceof categoryUpdate_js_1.CategoryUpdateError ? error.status : 503).json({ success: false,
            message: error instanceof categoryUpdate_js_1.CategoryUpdateError ? error.message : 'Unable to update category. Retry with the same names to confirm the outcome.' });
    }
});
// Existing outlet master documents only; never use the legacy in-memory category API.
for (const [route, collection] of [['categories', 'CATEGORY'], ['products', 'PRODUCT']]) {
    app.delete(`/api/outlets/:outletId/${route}/:documentId`, async (req, res) => {
        try {
            const result = await (0, outletDeletion_js_1.deleteOutletRecord)((0, firebase_js_2.getFirestoreDb)(), String(req.params.outletId ?? ''), collection, String(req.params.documentId ?? ''), readAccessToken(req)?.profileDocId ?? null, assignedOutletIds);
            res.json({ success: true, data: result });
        }
        catch (error) {
            res.status(error instanceof outletDeletion_js_1.OutletDeletionError ? error.status : 503).json({ success: false,
                message: error instanceof outletDeletion_js_1.OutletDeletionError ? error.message : 'Unable to delete this record. Retry to confirm the outcome.' });
        }
    });
}
// Form configuration is read only, scoped to the same authorized outlet as product imports.
app.get("/api/outlets/:outletId/products/create-options", async (req, res) => {
    try {
        const token = readAccessToken(req);
        const outletId = String(req.params.outletId ?? '');
        const deps = productImportDependencies();
        const profile = token ? await deps.readProfile(token.profileDocId) : undefined;
        (0, productCreation_js_1.requireProductOutlet)(token?.profileDocId ?? null, outletId, profile, assignedOutletIds);
        const [categories, products, premises] = await Promise.all([
            deps.readCategories(outletId), deps.readProducts(outletId), deps.readPremises(outletId),
        ]);
        res.json({ success: true, data: { code: (0, productImportValidation_js_1.nextProductCode)(products), categories,
                taxes: androidTaxes_js_1.ANDROID_TAX_OPTIONS, units: productCreation_js_1.PRODUCT_UNITS, premises } });
    }
    catch (error) {
        productCreationResponse(res, error);
    }
});
app.post("/api/outlets/:outletId/products", async (req, res) => {
    try {
        const product = await (0, productCreation_js_1.createOutletProduct)((0, firebase_js_2.getFirestoreDb)(), String(req.params.outletId ?? ''), readAccessToken(req)?.profileDocId ?? null, assignedOutletIds, req.body);
        res.status(201).json({ success: true, data: product });
    }
    catch (error) {
        productCreationResponse(res, error);
    }
});
function productCreationResponse(res, error) {
    if (error instanceof productCreation_js_1.ProductCreationError) {
        res.status(error.status).json({ success: false, message: error.message, errors: error.errors, nextCode: error.nextCode });
    }
    else {
        res.status(409).json({ success: false, message: error instanceof Error && /^(Row \d+ already|An existing product differs|An existing numeric Search Code|No safe numeric Search Codes)/.test(error.message)
                ? error.message.replace(/^Row \d+ already/, 'This product already') : 'Unable to save or load product details. Retry with the same form to reconcile the outcome.' });
    }
}
// Existing readers and authentication are reused; production writes remain gated.
function productImportDependencies() {
    return {
        readProfile: async (id) => (await (0, firebase_js_2.getFirestoreDb)().collection("USER_PROFILE").doc(id).get()).data(),
        assignedOutlets: assignedOutletIds,
        readCategories: async (id) => {
            const snapshot = await (0, firebase_js_2.getFirestoreDb)().collection("OUTLET").doc(id).collection("CATEGORY").get();
            return snapshot.docs.map(document => ({ id: document.id, name: stringValue(document.data().name),
                categoryNo: typeof document.data().categoryNo === "number" ? document.data().categoryNo : null }));
        },
        readProducts: async (id) => (await (0, firebase_js_2.getFirestoreDb)().collection("OUTLET").doc(id).collection("PRODUCT").get()).docs
            .map(document => ({ id: document.id, fields: document.data() })),
        readPremises: async (id) => (await (0, firebase_js_2.getFirestoreDb)().collection('OUTLET').doc(id).collection('PREMISES').get()).docs
            .map(document => ({ id: document.id, name: stringValue(document.data().name) })),
        readTaxes: async () => {
            const snapshot = await (0, firebase_js_2.getFirestoreDb)().collection("MASTERS").doc("masters").collection("TAX_MASTER").get();
            return snapshot.docs.map(document => document.data()).filter(data => typeof data.percent === "number" && Number.isFinite(data.percent)
                && typeof data.index === "number" && Number.isSafeInteger(data.index)
                && typeof data.type === "number" && Number.isSafeInteger(data.type)).map(data => ({ percent: data.percent, index: data.index, type: data.type }));
        },
    };
}
// Quota inspection is authorized and never consumes an upload attempt.
app.get("/api/outlets/:outletId/products/import/quota", async (req, res) => {
    const token = readAccessToken(req);
    const parameter = req.params.outletId;
    const outletId = Array.isArray(parameter) ? parameter[0] ?? "" : parameter ?? "";
    res.setHeader("Cache-Control", "no-store");
    try {
        if (!token)
            throw new productCreation_js_1.ProductCreationError(401, "Your session has expired. Please sign in again.");
        const profile = await productImportDependencies().readProfile(token.profileDocId);
        (0, productCreation_js_1.requireProductOutlet)(token.profileDocId, outletId, profile, assignedOutletIds);
        const quota = productImportQuota.check(outletId);
        res.json({ success: true, ...quota });
    }
    catch (error) {
        if (error instanceof productImportQuota_js_1.ProductImportQuotaError) {
            res.setHeader("Retry-After", String(error.retryAfterSeconds));
            res.status(429).json({ success: false, message: error.message, nextAvailableAt: error.nextAvailableAt });
        }
        else {
            res.status(error instanceof productCreation_js_1.ProductCreationError ? error.status : 503).json({ success: false,
                message: error instanceof productCreation_js_1.ProductCreationError ? error.message : "Unable to check the upload limit." });
        }
    }
});
app.post("/api/outlets/:outletId/products/import/validate", async (req, res) => {
    const token = readAccessToken(req);
    const parameter = req.params.outletId;
    const outletId = Array.isArray(parameter) ? parameter[0] ?? "" : parameter ?? "";
    try {
        const result = await (0, productImportValidation_js_1.checkAuthorizedProductImport)(token?.profileDocId ?? null, outletId, req.body?.source, productImportDependencies(), () => productImportQuota.check(outletId));
        res.status(result.status).json({ ...result.body, writesEnabled: productImportValidation_js_1.PRODUCT_IMPORT_WRITES_ENABLED });
    }
    catch (error) {
        if (error instanceof productImportQuota_js_1.ProductImportQuotaError) {
            res.setHeader("Retry-After", String(error.retryAfterSeconds));
            res.status(429).json({ success: false, message: error.message, nextAvailableAt: error.nextAvailableAt });
            return;
        }
        res.status(503).json({ success: false, message: "Unable to validate the import. No products were written." });
    }
});
// Both entry points share the same outlet counter. Premises persistence stays disabled.
app.post(["/api/outlets/:outletId/products/import", "/api/outlets/:outletId/products/import/premises"], async (req, res) => {
    const token = readAccessToken(req);
    const parameter = req.params.outletId;
    const outletId = Array.isArray(parameter) ? parameter[0] ?? "" : parameter ?? "";
    try {
        const checked = await (0, productImportValidation_js_1.checkAuthorizedProductImport)(token?.profileDocId ?? null, outletId, req.body?.source, productImportDependencies(), () => {
            productImportQuota.accept(outletId);
            // Never strip premises columns or pass a premises request to the standard writer.
            if (/\/premises\/?$/i.test(req.path)) {
                throw new productCreation_js_1.ProductCreationError(422, "Premises prices cannot be imported until the columns are mapped to this outlet's configured premises. No products were saved.");
            }
        });
        if (checked.status !== 200 || !checked.body.data?.canUpload) {
            res.status(checked.status).json(checked.body);
            return;
        }
        if (!productImportValidation_js_1.PRODUCT_IMPORT_WRITES_ENABLED) {
            res.status(403).json({ success: false, message: "File validated. Production upload is disabled pending review and approval. No products were saved." });
            return;
        }
        const codes = req.body?.codes;
        if (!Array.isArray(codes) || codes.length !== checked.body.data.documents.length
            || codes.some((code, index) => code !== checked.body.data.documents[index].fields.code)) {
            res.status(409).json({ success: false, message: "Search Codes changed or were not previewed. Review the updated preview before uploading again." });
            return;
        }
        const result = await (0, productImportValidation_js_1.persistProductImport)(outletId, checked.body.data.documents, {
            enabled: productImportValidation_js_1.PRODUCT_IMPORT_WRITES_ENABLED,
            readExisting: async (id) => (await (0, firebase_js_2.getFirestoreDb)().collection("OUTLET").doc(id).collection("PRODUCT").get()).docs
                .map(document => ({ id: document.id, fields: document.data() })),
            createChunk: (id, documents) => (0, productImportWriter_js_1.createProductImportChunk)((0, firebase_js_2.getFirestoreDb)(), id, documents),
        });
        res.status(result.success ? 200 : 503).json({ success: result.success, data: result });
    }
    catch (error) {
        if (error instanceof productImportQuota_js_1.ProductImportQuotaError) {
            res.setHeader("Retry-After", String(error.retryAfterSeconds));
            res.status(429).json({ success: false, message: error.message, nextAvailableAt: error.nextAvailableAt });
            return;
        }
        if (error instanceof productCreation_js_1.ProductCreationError) {
            res.status(error.status).json({ success: false, message: error.message });
            return;
        }
        res.status(409).json({ success: false, message: error instanceof Error && /^(Row \d+ already|Search Codes changed|An existing product differs|An existing numeric Search Code|No safe numeric Search Codes)/.test(error.message)
                ? error.message : "Import could not be completed. Keep the same file for reconciliation; existing products were not overwritten." });
    }
});
// Creates a new category document only; existing category records are never updated.
app.post("/api/outlets/:outletId/categories", async (req, res) => {
    const token = readAccessToken(req);
    if (!token) {
        res.status(401).json({ success: false, message: "Your session has expired. Please sign in again." });
        return;
    }
    const outletParam = req.params.outletId;
    const outletId = Array.isArray(outletParam) ? outletParam[0] : outletParam;
    const input = zod_1.z.object({
        categoryNo: zod_1.z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
        name: zod_1.z.string().trim().min(1).max(200),
        regionalName: zod_1.z.string().trim().max(200).default(""),
        dayType: zod_1.z.string().trim().max(100).default(""),
    }).safeParse(req.body);
    if (!outletId || !input.success) {
        res.status(400).json({ success: false, message: "A category name and positive whole category number are required." });
        return;
    }
    try {
        const db = (0, firebase_js_2.getFirestoreDb)();
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
        const duplicate = await db.runTransaction(async (transaction) => {
            const snapshot = await transaction.get(collection);
            const exists = snapshot.docs.some(document => {
                const category = document.data();
                return category.categoryNo === input.data.categoryNo
                    || stringValue(category.name).trim().toLowerCase() === input.data.name.toLowerCase();
            });
            if (exists)
                return true;
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
    }
    catch (error) {
        console.error("Creating category failed:", error);
        res.status(503).json({ success: false, message: "Unable to add the category right now." });
    }
});
// Current balances are authoritative; movement history must not be applied again.
// Only explicitly stockable products participate in the inventory report.
app.get("/api/outlets/:outletId/reports/stock", async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
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
        const db = (0, firebase_js_2.getFirestoreDb)();
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
    }
    catch (error) {
        console.error("Loading stock report failed:", error);
        res.status(503).json({ success: false, message: "Unable to load the stock report right now" });
    }
});
// GST report: taxable value, CGST/SGST/IGST and GST-inclusive totals per rate and per bill.
app.get("/api/outlets/:outletId/reports/gst", async (req, res) => {
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
        const db = (0, firebase_js_2.getFirestoreDb)();
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
        const emptyTotals = () => ({ taxable: 0, cgst: 0, sgst: 0, igst: 0, gst: 0, gross: 0 });
        const addTotals = (target, source) => {
            target.taxable += source.taxable;
            target.cgst += source.cgst;
            target.sgst += source.sgst;
            target.igst += source.igst;
            target.gst += source.gst;
            target.gross += source.gross;
        };
        const rates = new Map();
        const bills = [];
        for (const document of snapshots.flatMap(snapshot => snapshot.docs)) {
            const bill = document.data();
            const billNo = stringValue(bill.billNo) || stringValue(bill.serialNo) || document.id;
            const rawTaxType = stringValue(bill.taxType) || "NoTax";
            const taxType = rawTaxType.toLowerCase();
            if (shiftId && !stringValue(bill.shiftId).toLowerCase().includes(shiftId))
                continue;
            if (taxTypeFilter && taxType !== taxTypeFilter)
                continue;
            if (search && !billNo.toLowerCase().includes(search) && !stringValue(bill.serialNo).toLowerCase().includes(search))
                continue;
            const billTotals = emptyTotals();
            const billRates = new Set();
            const billItems = [];
            const items = Array.isArray(bill.billSaleItems) ? bill.billSaleItems : [];
            for (const rawItem of items) {
                const item = rawItem && typeof rawItem === "object" ? rawItem : {};
                if (item.deleted === true)
                    continue;
                const lineTotal = numberValue(item.total);
                const rate = taxType === "notax" ? 0 : numberValue(item.taxPercentage);
                // Inclusive prices already contain GST; exclusive prices have GST added on top.
                const gst = rate <= 0 ? 0
                    : taxType === "inclusive" ? lineTotal - lineTotal / (1 + rate / 100)
                        : lineTotal * rate / 100;
                const taxable = taxType === "inclusive" ? lineTotal - gst : lineTotal;
                // Split using the POS's own tax lines when present; otherwise assume intra-state (half CGST, half SGST).
                const taxItems = Array.isArray(item.taxItems) ? item.taxItems : [];
                const split = { cgst: 0, sgst: 0, igst: 0 };
                for (const rawTax of taxItems) {
                    const tax = rawTax && typeof rawTax === "object" ? rawTax : {};
                    const title = stringValue(tax.title).toUpperCase();
                    if (title === "CGST")
                        split.cgst += numberValue(tax.value);
                    else if (title === "SGST")
                        split.sgst += numberValue(tax.value);
                    else if (title === "IGST")
                        split.igst += numberValue(tax.value);
                }
                const splitSum = split.cgst + split.sgst + split.igst;
                const lineTotals = splitSum > 0
                    ? { taxable, cgst: gst * split.cgst / splitSum, sgst: gst * split.sgst / splitSum, igst: gst * split.igst / splitSum, gst, gross: taxable + gst }
                    : { taxable, cgst: gst / 2, sgst: gst / 2, igst: 0, gst, gross: taxable + gst };
                const rateTotals = rates.get(rate) ?? { ...emptyTotals(), rate, itemCount: 0, bills: new Set() };
                addTotals(rateTotals, lineTotals);
                rateTotals.itemCount += numberValue(item.quantity);
                rateTotals.bills.add(document.id);
                rates.set(rate, rateTotals);
                addTotals(billTotals, lineTotals);
                billRates.add(rate);
                const product = item.product && typeof item.product === "object" ? item.product : {};
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
        for (const bill of bills)
            addTotals(summary, bill);
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
    }
    catch (error) {
        console.error("Loading GST report failed:", error);
        res.status(503).json({ success: false, message: "Unable to load the GST report right now" });
    }
});
// Product-wise sales report with product codes, scoped to an assigned outlet.
app.get("/api/outlets/:outletId/reports/products", async (req, res) => {
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
        const db = (0, firebase_js_2.getFirestoreDb)();
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
        const codeLabel = (value) => typeof value === "number" && Number.isFinite(value) ? String(value) : stringValue(value).trim();
        const products = new Map();
        const allBills = new Set();
        for (const document of billSnapshots.flatMap(snapshot => snapshot.docs)) {
            const bill = document.data();
            if (shiftId && !stringValue(bill.shiftId).toLowerCase().includes(shiftId))
                continue;
            const items = Array.isArray(bill.billSaleItems) ? bill.billSaleItems : [];
            for (const rawItem of items) {
                const item = rawItem && typeof rawItem === "object" ? rawItem : {};
                if (item.deleted === true)
                    continue;
                const product = item.product && typeof item.product === "object" ? item.product : {};
                const name = stringValue(product.name).trim() || stringValue(product.shortName).trim() || "Item";
                const productId = stringValue(product.id) || name;
                const code = codeLabel(productCodes.get(productId)) || codeLabel(product.code);
                const categoryId = stringValue(product.category);
                const category = categoryNames.get(categoryId) || (categoryId ? "Unknown category" : "Uncategorized");
                if (search
                    && !name.toLowerCase().includes(search)
                    && !code.toLowerCase().includes(search)
                    && !category.toLowerCase().includes(search))
                    continue;
                const totals = products.get(productId) ?? {
                    productId, code, name, category, quantity: 0, amount: 0, bills: new Set(), taxRates: new Set(), taxGroups: new Map()
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
    }
    catch (error) {
        console.error("Loading product-wise report failed:", error);
        res.status(503).json({ success: false, message: "Unable to load the product-wise report right now" });
    }
});
// Shift summary report: every shift per day ID within the range, scoped to an assigned outlet.
app.get("/api/outlets/:outletId/reports/shifts", async (req, res) => {
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
        const db = (0, firebase_js_2.getFirestoreDb)();
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
    }
    catch (error) {
        console.error("Loading shift summary report failed:", error);
        res.status(503).json({ success: false, message: "Unable to load the shift summary report right now" });
    }
});
// Category Endpoints (CRUD)
// 1. List all categories
app.get("/api/categories", (_req, res) => {
    res.json({
        success: true,
        data: categories
    });
});
// 2. Create new category
app.post("/api/categories", (req, res) => {
    const { code, name, description, status, color } = req.body;
    if (!name || typeof name !== "string" || !name.trim()) {
        res.status(400).json({
            success: false,
            message: "Category name is required"
        });
        return;
    }
    const newCategory = {
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
app.put("/api/categories/:id", (req, res) => {
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
    const updated = {
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
app.delete("/api/categories/:id", (req, res) => {
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
        (0, firebase_js_2.getFirebaseApp)();
    }
    catch (error) {
        (0, firebase_js_2.logFirebaseConfigurationError)(error, "startup");
    }
});
//# sourceMappingURL=server.js.map