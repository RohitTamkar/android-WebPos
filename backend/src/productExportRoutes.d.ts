import { type Request } from 'express';
import { type ProductExportDependencies } from './productExcel.js';
import { sendProductExportEmail } from './productExportMail.js';
export declare function productExportRouter(dependencies: () => ProductExportDependencies, profileId: (request: Request) => string | null, send?: typeof sendProductExportEmail): import("express-serve-static-core").Router;
//# sourceMappingURL=productExportRoutes.d.ts.map