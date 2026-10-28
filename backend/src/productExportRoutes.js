import { Router } from 'express';
import { z } from 'zod';
import { ProductCreationError } from './productCreation.js';
import { createProductExport, XLSX_TYPE } from './productExcel.js';
import { sendProductExportEmail } from './productExportMail.js';
const emailSchema = z.object({ email: z.string().trim().max(254).pipe(z.email()) }).strict();
export function productExportRouter(dependencies, profileId, send = sendProductExportEmail) {
    const router = Router({ mergeParams: true });
    const sending = new Set();
    const fail = (response, error) => {
        response.status(error instanceof ProductCreationError ? error.status : 503).json({ success: false,
            message: error instanceof ProductCreationError ? error.message : 'Unable to export products right now. Please try again.' });
    };
    router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
    router.get('/download', async (req, res) => {
        try {
            const result = await createProductExport(dependencies(), String(req.params.outletId ?? ''), profileId(req));
            res.setHeader('Content-Type', XLSX_TYPE);
            res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
            res.setHeader('X-Export-Warnings', String(result.warnings));
            res.send(result.buffer);
        }
        catch (error) {
            fail(res, error);
        }
    });
    router.post('/email', async (req, res) => {
        const id = profileId(req);
        const outlet = String(req.params.outletId ?? '');
        const key = `${id}:${outlet}`;
        if (!id) {
            fail(res, new ProductCreationError(401, 'Your session has expired. Please sign in again.'));
            return;
        }
        const parsed = emailSchema.safeParse(req.body);
        if (!parsed.success) {
            fail(res, new ProductCreationError(422, 'Enter a valid email address.'));
            return;
        }
        if (sending.has(key)) {
            fail(res, new ProductCreationError(409, 'An email export is already in progress.'));
            return;
        }
        sending.add(key);
        try {
            const result = await createProductExport(dependencies(), outlet, id);
            await send(parsed.data.email, result);
            res.json({ success: true, message: 'Product Excel accepted by the mail service for sending.', warnings: result.warnings });
        }
        catch (error) {
            fail(res, error);
        }
        finally {
            sending.delete(key);
        }
    });
    return router;
}
//# sourceMappingURL=productExportRoutes.js.map