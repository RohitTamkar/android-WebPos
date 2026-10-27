import assert from 'node:assert/strict';
import test from 'node:test';
import type { Firestore } from 'firebase-admin/firestore';
import { planImportCategories, resolveImportCategories } from '../src/productImportCategories.js';
import { checkAuthorizedProductImport, type ImportValidationDependencies } from '../src/productImportValidation.js';
import { persistProductImportWithCategories } from '../src/productImportFlow.js';
import { createProductImportChunk } from '../src/productImportWriter.js';
import { PRODUCT_COLUMNS } from '../../frontend/src/pages/productCsvPreview.js';

const row = ['Tea','Tea','20','20','0','0','Food','1','0','0001','number','0','no','1'];
const csv = (rows = [row]) => [PRODUCT_COLUMNS.join(','), ...rows.map(cells => cells.join(','))].join('\n');
const assigned = (profile: Record<string, unknown>) => profile.outlets as string[];
function fixture() {
  const records = new Map<string, Record<string, unknown>>([
    ['USER_PROFILE/user', { active: true, outlets: ['outlet'] }], ['OUTLET/outlet', { active: true }],
  ]);
  const versions = new Map<string, number>();
  const events: string[] = [], batches: number[] = [];
  let serial = 0, failCategories = false, failProductBatch = 0, productBatches = 0, lostCategory = false;
  type Ref = { path: string; id: string; collection: (name: string) => Ref; doc: (id?: string) => Ref };
  const ref = (path: string): Ref => ({ path, id: path.split('/').at(-1)!, collection: name => ref(`${path}/${name}`), doc: id => ref(`${path}/${id ?? String(++serial).padStart(20, 'a')}`) });
  const direct = (path: string) => [...records].filter(([key]) => key.startsWith(`${path}/`) && key.split('/').length === path.split('/').length + 1);
  const db = { collection: ref, runTransaction: async (work: any) => {
    for (let attempt = 0; attempt < 10; attempt++) {
      const reads = new Map<string, number>(), writes: { path: string; fields: Record<string, unknown> }[] = [];
      const result = await work({ get: async (reference: Ref) => {
        assert.equal(writes.length, 0, 'all reads precede writes'); reads.set(reference.path, versions.get(reference.path) ?? 0);
        const data = structuredClone(records.get(reference.path));
        const docs = direct(reference.path).map(([path, values]) => ({ id: path.split('/').at(-1)!, data: () => structuredClone(values) }));
        await Promise.resolve(); return { exists: !!data, data: () => data, docs };
      }, create: (reference: Ref, fields: Record<string, unknown>) => writes.push({ path: reference.path, fields }) });
      if ([...reads].some(([path, version]) => (versions.get(path) ?? 0) !== version)) continue;
      const category = writes.some(write => write.path.includes('/CATEGORY/'));
      const product = writes.some(write => write.path.includes('/PRODUCT/'));
      if (category && failCategories) throw new Error('Category commit failed');
      if (product && ++productBatches === failProductBatch) throw new Error('Product commit failed');
      for (const write of writes) {
        assert.equal(records.has(write.path), false, 'never overwrite existing records');
        if (write.path.includes('/PRODUCT/')) assert.ok(records.has(`OUTLET/outlet/CATEGORY/${write.fields.category}`), 'product category is persisted before product creation');
      }
      for (const write of writes) {
        records.set(write.path, write.fields); events.push(write.path);
        versions.set(write.path, (versions.get(write.path) ?? 0) + 1);
        const parent = write.path.split('/').slice(0, -1).join('/'); versions.set(parent, (versions.get(parent) ?? 0) + 1);
      }
      if (writes.length) batches.push(writes.length);
      if (category && lostCategory) { lostCategory = false; throw new Error('Category response lost after commit'); }
      return result;
    }
    throw new Error('Too much contention');
  } } as unknown as Firestore;
  const deps: ImportValidationDependencies = {
    readProfile: async id => records.get(`USER_PROFILE/${id}`), assignedOutlets: assigned,
    readCategories: async outlet => direct(`OUTLET/${outlet}/CATEGORY`).map(([path, data]) => ({ id: path.split('/').at(-1)!, name: data.name as string, categoryNo: data.categoryNo as number })),
    readTaxes: async () => [{ percent: 0, index: 1, type: 0 }],
    readProducts: async outlet => direct(`OUTLET/${outlet}/PRODUCT`).map(([path, fields]) => ({ id: path.split('/').at(-1)!, fields })),
  };
  const resolve = (source: string, outlet = 'outlet', profile: string | null = 'user') => resolveImportCategories(db, outlet, profile, assigned, source);
  const upload = async (source = csv(), outlet = 'outlet', profile = 'user') => {
    const preview = await checkAuthorizedProductImport(profile, outlet, source, deps);
    const codes = preview.body.data?.documents.map(document => document.fields.code) ?? [];
    return persistProductImportWithCategories(outlet, profile, source, codes, deps, () => resolve(source, outlet, profile), {
      enabled: true, readExisting: deps.readProducts, createChunk: (id, documents) => createProductImportChunk(db, id, documents),
    });
  };
  return { db, records, events, batches, deps, resolve, upload,
    failCategories: () => { failCategories = true; }, failSecondProductBatch: () => { failProductBatch = 2; },
    recover: () => { failProductBatch = 0; }, loseCategoryResponse: () => { lostCategory = true; } };
}

test('read-only preview plans missing categories; confirmation creates exact master schema before products', async () => {
  const f = fixture();
  const preview = await checkAuthorizedProductImport('user','outlet',csv(),f.deps);
  assert.equal(preview.status, 200); assert.equal(f.events.length, 0);
  const result = await f.upload(); assert.equal(result.success, true); assert.equal(result.categoriesCreated, 1); assert.equal(result.categoriesReused, 0); assert.equal(result.created, 1);
  assert.match(f.events[0]!, /\/CATEGORY\//); assert.match(f.events[1]!, /\/PRODUCT\//);
  const category = f.records.get(f.events[0]!)!;
  assert.deepEqual(category, { id: f.events[0]!.split('/').at(-1), name: 'Food', categoryNo: 1, regionalName: '', dayType: '', onlineSynced: false, selected: false });
  const product = f.records.get(f.events[1]!)!; assert.equal(product.category, category.id); assert.equal(product.price,20); assert.equal(product.costPrice,0); assert.equal(product.currentStock,0); assert.equal(product.unitId,2);
  const retry = await f.upload(); assert.equal(retry.success,true); assert.equal(retry.created,0); assert.equal(retry.existing,1); assert.equal(retry.categoriesCreated,0); assert.equal(retry.categoriesReused,1); assert.equal(f.events.length,2);
});
test('existing categories use their actual arbitrary IDs; multiple rows reuse one missing category', async () => {
  const f = fixture(); f.records.set('OUTLET/outlet/CATEGORY/existing-id', { id:'existing-id', name:'Food', categoryNo:1, custom:'keep' });
  const two = [...row]; two[0]='Coffee'; const result = await f.upload(csv([row,two]));
  assert.equal(result.categoriesCreated,0); assert.equal(result.categoriesReused,1); assert.equal(result.created,2);
  assert.ok(f.events.every(path => f.records.get(path)!.category === 'existing-id'));
  assert.equal(f.records.get('OUTLET/outlet/CATEGORY/existing-id')!.custom,'keep');
  const missing = fixture(); const shared = await missing.upload(csv([row,two])); assert.equal(shared.categoriesCreated,1); assert.equal(shared.created,2);
});
test('spreadsheet category numbers are ignored; new names receive sequential numbers in first appearance order', async () => {
  const f = fixture();
  f.records.set('OUTLET/outlet/CATEGORY/existing-id', { id:'existing-id', name:'Existing', categoryNo:7, custom:'keep' });
  const rows = ['Food','Drinks',' food ','Existing'].map((name,index) => {
    const cells = [...row]; cells[0] = `Product ${index}`; cells[6] = name; cells[7] = index === 2 ? '99' : '1'; cells[10] = 'Number'; return cells;
  });
  const preview = await checkAuthorizedProductImport('user','outlet',csv(rows),f.deps);
  assert.equal(preview.status,200); assert.equal(f.events.length,0);
  const result = await f.upload(csv(rows));
  assert.equal(result.success,true); assert.equal(result.categoriesCreated,2); assert.equal(result.categoriesReused,1); assert.equal(result.created,4);
  const categories = f.events.filter(path => path.includes('/CATEGORY/')).map(path => f.records.get(path)!);
  assert.deepEqual(categories.map(category => [category.name,category.categoryNo]),[['Food',8],['Drinks',9]]);
  const products = f.events.filter(path => path.includes('/PRODUCT/')).map(path => f.records.get(path)!);
  assert.equal(products[0]!.category,products[2]!.category);
  assert.equal(products[3]!.category,'existing-id');
  assert.equal(f.records.get('OUTLET/outlet/CATEGORY/existing-id')!.custom,'keep');
  const retry = await f.upload(csv(rows)); assert.equal(retry.success,true); assert.equal(retry.categoriesCreated,0); assert.equal(retry.created,0); assert.equal(retry.existing,4);
});
test('ambiguous category names report all affected source rows without writes', async () => {
  const f = fixture();
  for (const cat of [{id:'a',name:'Food',categoryNo:1},{id:'b',name:' FOOD ',categoryNo:2}]) f.records.set(`OUTLET/outlet/CATEGORY/${cat.id}`,cat);
  const second = [...row]; second[0]='Coffee'; second[7]='99';
  assert.deepEqual(planImportCategories(csv([row,second]), await f.deps.readCategories('outlet')).issues.map(issue=>issue.rowNumber),[2,3]);
  assert.equal((await f.upload(csv([row,second]))).success,false); assert.equal(f.events.length,0);
});
test('category number exhaustion prevents writes', async () => {
  const f = fixture(); f.records.set('OUTLET/outlet/CATEGORY/last',{name:'Last',categoryNo:Number.MAX_SAFE_INTEGER});
  assert.equal((await f.upload()).success,false); assert.equal(f.events.length,0);
});
test('invalid product values or categories stop before category writes', async () => {
  for (const [column,value] of [[3,'25'],[8,'99'],[6,''],[7,'invalid']] as const) {
    const f=fixture(), bad=[...row];bad[column]=value;assert.equal((await f.upload(csv([bad]))).success,false);assert.equal(f.events.length,0);
  }
  const f=fixture();assert.equal((await f.upload(csv([row,row]))).success,false);assert.equal(f.events.length,0);
});
test('category creation failure or ambiguous commit prevents all products; retry reuses committed categories', async () => {
  const failed=fixture();failed.failCategories();const result=await failed.upload();assert.equal(result.success,false);assert.equal(result.created,0);assert.equal(result.failedRows,1);assert.equal(failed.events.length,0);
  const lost=fixture();lost.loseCategoryResponse();assert.equal((await lost.upload()).success,false);assert.equal(lost.events.length,1);
  const retry=await lost.upload();assert.equal(retry.success,true);assert.equal(retry.categoriesCreated,0);assert.equal(retry.categoriesReused,1);assert.equal(retry.created,1);
});
test('partial product failure retains categories and reports rows; retry reconciles without duplicates', async () => {
  const f=fixture();const rows=Array.from({length:105},(_,index)=>{const cells=[...row];cells[0]=`Product ${index}`;return cells;});f.failSecondProductBatch();
  const result=await f.upload(csv(rows));assert.equal(result.success,false);assert.equal(result.categoriesCreated,1);assert.equal(result.created,100);assert.equal(result.failedRows,5);assert.deepEqual(result.unconfirmedRows,[102,103,104,105,106]);
  f.recover();const retry=await f.upload(csv(rows));assert.equal(retry.success,true);assert.equal(retry.categoriesCreated,0);assert.equal(retry.existing,100);assert.equal(retry.created,5);
  assert.equal(f.events.filter(path=>path.includes('/CATEGORY/')).length,1);assert.equal(f.events.filter(path=>path.includes('/PRODUCT/')).length,105);
});
test('concurrent uploads and Category Master-style inserts reuse a unique category', async () => {
  const f=fixture();const results=await Promise.all([f.resolve(csv()),f.resolve(csv())]);assert.ok(results.every(result=>result.success));assert.equal(results.reduce((sum,result)=>sum+result.created,0),1);assert.equal(f.events.length,1);
});
test('concurrent different category names receive distinct sequential numbers', async () => {
  const f=fixture(); const other=[...row]; other[6]='Drinks';
  const results=await Promise.all([f.resolve(csv()),f.resolve(csv([other]))]);
  assert.ok(results.every(result=>result.success));
  const numbers=f.events.map(path=>f.records.get(path)!.categoryNo).sort();
  assert.deepEqual(numbers,[1,2]);
});
test('many categories use bounded writes and resolve before any products', async () => {
  const f=fixture();const rows=Array.from({length:205},(_,index)=>{const cells=[...row];cells[0]=`Product ${index}`;cells[6]=`Category ${index}`;cells[7]='1';return cells;});
  const result=await f.upload(csv(rows));assert.equal(result.success,true);assert.equal(result.categoriesCreated,205);assert.equal(result.created,205);assert.ok(f.batches.every(size=>size<=100));
  assert.ok(f.events.slice(0,205).every(path=>path.includes('/CATEGORY/')));
  assert.deepEqual(f.events.slice(0,205).map(path=>f.records.get(path)!.categoryNo),Array.from({length:205},(_,index)=>index+1));
});
test('unauthorized, inactive and foreign-outlet users cannot create categories or products', async () => {
  for(const mode of ['foreign','inactive','outlet']){const f=fixture();if(mode==='inactive')f.records.get('USER_PROFILE/user')!.active=false;
    if(mode==='outlet')f.records.get('OUTLET/outlet')!.active=false;
    assert.equal((await f.upload(csv(),mode==='foreign'?'other':'outlet')).success,false);assert.equal(f.events.length,0);}
  const f=fixture();await assert.rejects(f.resolve(csv(),'outlet',null));assert.equal(f.events.length,0);
});
