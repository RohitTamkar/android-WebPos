import assert from 'node:assert/strict';
import test from 'node:test';
import type { Firestore } from 'firebase-admin/firestore';
import { listOutletServicePoints, createOutletServicePoint, updateOutletServicePoint, deleteOutletServicePoint, assignCategoryServicePoint } from '../src/servicePoints.js';
const assigned = (profile: Record<string, unknown>) => [profile.outletId, ...(Array.isArray(profile.outlets) ? profile.outlets : [])].filter((id): id is string => typeof id === 'string');
const point = { name: 'Existing Kitchen', paperSize: 3, printerType: 1, header: 'Header', subHeader: '', footer: '', printerIpAddress: '', port: 9100, usbPath: null, id: null };
const draft = { requestId: '11111111-1111-4111-8111-111111111111', name: 'New Kitchen', paperSize: 2, printerType: 0, header: 'Top', subHeader: 'Middle', footer: 'Bottom', printerIpAddress: '', port: 0, usbPath: null };
function fixture() {
  const records = new Map<string, Record<string, unknown>>([
    ['OUTLET/outlet', { active: true }], ['OUTLET/foreign', { active: true }],
    ['USER_PROFILE/current', { active: true, outletId: 'outlet', name: 'Signed User', quickPin: 'SECRET' }],
    ['USER_PROFILE/colleague', { active: true, outlets: ['outlet'], outletList: ['outlet'], name: 'Colleague', quickPin: 'SECRET' }],
    ['USER_PROFILE/foreign-user', { active: true, outletId: 'foreign', name: 'Foreign User' }],
    ['USER_PROFILE/inactive', { active: false, outletId: 'outlet', name: 'Inactive User' }],
    ['OUTLET/outlet/SERVICE_POINT/existing', structuredClone(point)],
    ['OUTLET/foreign/SERVICE_POINT/other', { ...point, name: 'Foreign Person' }],
  ]);
  const reads: string[] = [], writes: { path: string; fields: Record<string, unknown> }[] = [];
  let failCommit = false;
  function collection(path: string, filters: [string, string, unknown][] = [], fields?: string[]): any {
    return { path, isCollection: true,
      doc: (id: string) => doc(`${path}/${id}`),
      where: (key: string, op: string, value: unknown) => collection(path, [...filters, [key, op, value]], fields),
      select: (...selected: string[]) => collection(path, filters, selected),
      limit: () => collection(path, filters, fields),
      get: async () => {
        reads.push(path);
        const docs = [...records].filter(([key, value]) => key.startsWith(path + '/') && key.split('/').length === path.split('/').length + 1
          && filters.every(([field, op, expected]) => op === 'array-contains' ? Array.isArray(value[field]) && value[field].includes(expected) : value[field] === expected))
          .map(([key, value]) => ({ id: key.split('/').at(-1), data: () => fields ? Object.fromEntries(fields.filter(f => f in value).map(f => [f, value[f]])) : structuredClone(value) }));
        return { docs, size: docs.length, empty: !docs.length };
      },
    };
  }
  function doc(path: string): any {
    return { path, id: path.split('/').at(-1), collection: (name: string) => collection(`${path}/${name}`),
      get: async () => { reads.push(path); return { exists: records.has(path), data: () => records.has(path) ? structuredClone(records.get(path)) : undefined }; },
    };
  }
  const db = { collection,
    runTransaction: async (work: (tx: unknown) => unknown) => {
      const pending: { path: string; fields: Record<string, unknown>; update?: boolean; delete?: boolean }[] = [];
      const result = await work({ get: (ref: any) => ref.get(), create: (ref: any, fields: Record<string, unknown>) => {
        assert.ok(!records.has(ref.path), 'Never overwrite existing service point'); pending.push({ path: ref.path, fields });
      }, update: (ref: any, fields: Record<string, unknown>) => {
        assert.ok(records.has(ref.path), 'Updates require an existing record'); pending.push({path:ref.path,fields,update:true});
      }, delete: (ref: any) => { pending.push({path:ref.path,fields:{},delete:true}); } });
      if (failCommit) throw new Error('DATABASE FAILURE');
      for (const write of pending) {
        if (write.delete) records.delete(write.path);
        else records.set(write.path, structuredClone(write.update ? {...records.get(write.path),...write.fields} : write.fields));
        writes.push({path:write.path,fields:write.fields});
      }
      return result;
    },
  } as unknown as Firestore;
  return { db, records, reads, writes, fail: () => { failCommit = true; } };
}

test('lists existing outlet service points with null IDs and optional fields without any writes', async () => {
 const f=fixture(), before=structuredClone(f.records);
 const result=await listOutletServicePoints(f.db,'outlet','current',assigned);
 assert.equal(result.servicePoints.length,1); assert.equal(result.servicePoints[0]!.documentId,'existing');
 assert.equal(result.servicePoints[0]!.printerType,1); assert.equal(result.servicePoints[0]!.name,point.name);
 assert.deepEqual(f.records,before); assert.deepEqual(f.writes,[]);
 assert.ok(!JSON.stringify(result).includes('SECRET'));
});
test('creates only an existing-schema SERVICE_POINT document and supports idempotent retry',async()=>{
 const f=fixture(), before=structuredClone(f.records);
 const saved=await createOutletServicePoint(f.db,'outlet','current',assigned,draft);
 const {requestId:_,...fields}=draft;
 assert.deepEqual(f.writes,[{path:`OUTLET/outlet/SERVICE_POINT/${saved.documentId}`,fields:{...fields,id:saved.documentId}}]);
 assert.equal(typeof f.writes[0]!.fields.paperSize,'number'); assert.equal(typeof f.writes[0]!.fields.printerType,'number');
 for(const [path,record]of before)assert.deepEqual(f.records.get(path),record);
 assert.deepEqual(await createOutletServicePoint(f.db,'outlet','current',assigned,draft),saved);
 assert.equal(f.writes.length,1);
 await assert.rejects(createOutletServicePoint(f.db,'outlet','current',assigned,{...draft,name:'Changed'}),{status:409});
 assert.equal((await listOutletServicePoints(f.db,'outlet','current',assigned)).servicePoints.length,2);
});
test('validates names, supported paper/type IDs, connection values and rejects caller-selected fields',async()=>{
 const f=fixture();
 for(const patch of [{name:' '},{paperSize:4},{paperSize:'2'},{printerType:3},{port:-1},{port:65536},{port:1.5},{id:'overwrite'},{profileDocId:'foreign-user'},{kitchenId:'assign'}]){
  await assert.rejects(createOutletServicePoint(f.db,'outlet','current',assigned,{...draft,...patch}),{status:422});
 }
 await assert.rejects(createOutletServicePoint(f.db,'outlet','current',assigned,{...draft,name:' existing   kitchen '}),{status:409});
 assert.deepEqual(f.writes,[]);
});
test('supports Ethernet and USB connection fields without connecting to hardware',async()=>{
 for(const fields of [{printerType:1,paperSize:3,printerIpAddress:'192.168.1.10',port:9100,usbPath:null},{printerType:2,paperSize:2,printerIpAddress:'',port:0,usbPath:'/dev/usb/lp0'}]){
  const f=fixture();const saved=await createOutletServicePoint(f.db,'outlet','current',assigned,{...draft,...fields});
  for(const [key,value]of Object.entries(fields))assert.equal((saved as Record<string,unknown>)[key],value);
 }
});
test('requires active signed profiles, assigned active outlets and valid document paths for both operations',async()=>{
 for(const [outlet,user,status]of [['outlet',null,401],['foreign','current',403],['outlet','inactive',403],['outlet','missing',403],['bad/path','current',400],['..','current',400]]as const){
  const f=fixture();
  await assert.rejects(listOutletServicePoints(f.db,outlet,user,assigned),{status});
  await assert.rejects(createOutletServicePoint(f.db,outlet,user,assigned,draft),{status});assert.deepEqual(f.writes,[]);
 }
 const f=fixture(); f.records.set('OUTLET/outlet',{active:false});
 await assert.rejects(listOutletServicePoints(f.db,'outlet','current',assigned),{status:403});
 await assert.rejects(createOutletServicePoint(f.db,'outlet','current',assigned,draft),{status:403});
 f.records.delete('OUTLET/outlet');
 await assert.rejects(listOutletServicePoints(f.db,'outlet','current',assigned),{status:404});
 await assert.rejects(createOutletServicePoint(f.db,'outlet','current',assigned,draft),{status:404});
});
test('commit failures never report a saved service point or alter existing records',async()=>{
 const f=fixture(),before=structuredClone(f.records);f.fail();
 await assert.rejects(createOutletServicePoint(f.db,'outlet','current',assigned,draft),/DATABASE FAILURE/);
 assert.deepEqual(f.records,before);assert.deepEqual(f.writes,[]);
});

test('editing changes only submitted settings, preserves legacy IDs/custom fields and is retry safe', async () => {
 const f=fixture(), path='OUTLET/outlet/SERVICE_POINT/existing';
 f.records.set(path,{...point,custom:{keep:true},usbPath:'/existing/path'});
 const before=structuredClone(f.records);
 const result=await updateOutletServicePoint(f.db,'outlet','existing','current',assigned,{name:'Updated Kitchen',header:'New Header',paperSize:2});
 assert.equal(result.name,'Updated Kitchen');assert.equal(result.documentId,'existing');
 assert.deepEqual(f.writes,[{path,fields:{name:'Updated Kitchen',header:'New Header',paperSize:2}}]);
 assert.deepEqual(f.records.get(path),{...before.get(path),name:'Updated Kitchen',header:'New Header',paperSize:2});
 assert.equal(f.records.get(path)!.id,null);
 for(const [key,value]of before)if(key!==path)assert.deepEqual(f.records.get(key),value);
 await updateOutletServicePoint(f.db,'outlet','existing','current',assigned,{name:'Updated Kitchen',header:'New Header',paperSize:2});
 assert.equal(f.writes.length,1);
});
test('edits reject unauthorized identities, invalid paths, duplicates, protected fields and missing points', async () => {
 const f=fixture(); f.records.set('OUTLET/outlet/SERVICE_POINT/second',{...point,name:'Second'});
 for(const [outlet,id,user,patch,status]of [
  ['outlet','existing',null,{name:'New'},401], ['foreign','other','current',{name:'New'},403],
  ['outlet','../bad','current',{},400], ['outlet','missing','current',{},404],
  ['outlet','existing','current',{id:'changed'},422], ['outlet','existing','current',{printerType:9},422],
  ['outlet','existing','current',{name:' second '},409],
 ]as const)await assert.rejects(updateOutletServicePoint(f.db,outlet,id,user,assigned,patch),{status});
 assert.deepEqual(f.writes,[]);
});
function assignmentFixture(){
 const f=fixture();
 f.records.set('OUTLET/outlet/CATEGORY/c1',{name:'Food'});
 for(const [id,kitchenId,category]of [['p1','','c1'],['p2','old-point','c1'],['p3','existing','c1'],['p4','other','c2']]){
  f.records.set(`OUTLET/outlet/PRODUCT/${id}`,{name:id,category,kitchenId,price:50,currentStock:10,id:'stored-id',custom:{keep:true}});
 }
 return f;
}
test('category assignment updates kitchenId for all matching products atomically and preserves all other data',async()=>{
 const f=assignmentFixture(),before=structuredClone(f.records),input={categoryId:'c1',servicePointId:'existing'};
 assert.deepEqual(await assignCategoryServicePoint(f.db,'outlet','current',assigned,input),{...input,assignedCount:3,updatedCount:2});
 assert.deepEqual(f.writes.map(write=>write.path).sort(),['OUTLET/outlet/PRODUCT/p1','OUTLET/outlet/PRODUCT/p2']);
 f.writes.forEach(write=>assert.deepEqual(write.fields,{kitchenId:'existing'}));
 for(const [path,value]of before){
  assert.deepEqual(f.records.get(path),path.endsWith('/PRODUCT/p1')||path.endsWith('/PRODUCT/p2')?{...value,kitchenId:'existing'}:value);
 }
 assert.deepEqual(await assignCategoryServicePoint(f.db,'outlet','current',assigned,input),{...input,assignedCount:3,updatedCount:0});
 assert.equal(f.writes.length,2);
});
test('category assignment rejects foreign IDs, invalid requests and empty categories without writes',async()=>{
 for(const [outlet,user,input,status]of [
  ['outlet',null,{categoryId:'c1',servicePointId:'existing'},401],
  ['foreign','current',{categoryId:'c1',servicePointId:'existing'},403],
  ['outlet','current',{categoryId:'foreign',servicePointId:'existing'},404],
  ['outlet','current',{categoryId:'c1',servicePointId:'other'},404],
  ['outlet','current',{categoryId:'../c1',servicePointId:'existing'},422],
  ['outlet','current',{categoryId:'c1',servicePointId:'existing',profileDocId:'forged'},422],
 ]as const){const f=assignmentFixture();await assert.rejects(assignCategoryServicePoint(f.db,outlet,user,assigned,input),{status});assert.deepEqual(f.writes,[]);}
 const f=fixture();f.records.set('OUTLET/outlet/CATEGORY/empty',{name:'Empty'});
 await assert.rejects(assignCategoryServicePoint(f.db,'outlet','current',assigned,{categoryId:'empty',servicePointId:'existing'}),{status:409});
 assert.deepEqual(f.writes,[]);
});
test('deletion removes only the selected unassigned service point and is retry safe',async()=>{
 const f=fixture(), before=structuredClone(f.records), path='OUTLET/outlet/SERVICE_POINT/existing';
 assert.deepEqual(await deleteOutletServicePoint(f.db,'outlet','existing','current',assigned),{documentId:'existing'});
 assert.equal(f.records.has(path),false);
 for(const [key,value]of before)if(key!==path)assert.deepEqual(f.records.get(key),value);
 assert.deepEqual(f.writes,[{path,fields:{}}]);
 await deleteOutletServicePoint(f.db,'outlet','existing','current',assigned);
 assert.equal(f.writes.length,1);
});
test('deletion clears only matching product assignments and deletes the master atomically',async()=>{
 const f=assignmentFixture(),before=structuredClone(f.records);
 f.records.set('OUTLET/foreign/PRODUCT/foreign-product',{kitchenId:'existing',name:'Foreign'});
 await deleteOutletServicePoint(f.db,'outlet','existing','current',assigned);
 assert.equal(f.records.has('OUTLET/outlet/SERVICE_POINT/existing'),false);
 for(const [path,record]of before){
  if(path==='OUTLET/outlet/SERVICE_POINT/existing')continue;
  assert.deepEqual(f.records.get(path),path==='OUTLET/outlet/PRODUCT/p3'?{...record,kitchenId:''}:record);
 }
 assert.deepEqual(f.records.get('OUTLET/foreign/PRODUCT/foreign-product'),{kitchenId:'existing',name:'Foreign'});
 assert.deepEqual(f.writes,[{path:'OUTLET/outlet/PRODUCT/p3',fields:{kitchenId:''}},{path:'OUTLET/outlet/SERVICE_POINT/existing',fields:{}}]);
 await deleteOutletServicePoint(f.db,'outlet','existing','current',assigned);
 assert.equal(f.writes.length,2);
});
test('deletion clears all matching products across categories even when master is already missing',async()=>{
 const f=assignmentFixture();f.records.delete('OUTLET/outlet/SERVICE_POINT/existing');
 f.records.set('OUTLET/outlet/PRODUCT/another',{kitchenId:'existing',category:'c2',price:9});
 await deleteOutletServicePoint(f.db,'outlet','existing','current',assigned);
 assert.equal(f.records.get('OUTLET/outlet/PRODUCT/p3')!.kitchenId,'');
 assert.deepEqual(f.records.get('OUTLET/outlet/PRODUCT/another'),{kitchenId:'',category:'c2',price:9});
 assert.equal(f.writes.length,2);
});
test('deletion validates authentication, outlet access, active records and document paths',async()=>{
 for(const [outlet,id,user,status]of [
  ['outlet','existing',null,401],['foreign','other','current',403],['outlet','existing','inactive',403],
  ['outlet','existing','missing',403],['bad/path','existing','current',400],['outlet','../bad','current',400],
  ['outlet','','current',400],['outlet','..','current',400],
 ]as const){const f=fixture();await assert.rejects(deleteOutletServicePoint(f.db,outlet,id,user,assigned),{status});assert.deepEqual(f.writes,[]);}
 const f=fixture();f.records.set('OUTLET/outlet',{active:false});
 await assert.rejects(deleteOutletServicePoint(f.db,'outlet','existing','current',assigned),{status:403});
 f.records.delete('OUTLET/outlet');
 await assert.rejects(deleteOutletServicePoint(f.db,'outlet','existing','current',assigned),{status:404});
 assert.deepEqual(f.writes,[]);
});
test('failed deletion commits preserve the master and all assigned products',async()=>{
 const f=assignmentFixture(),before=structuredClone(f.records);f.fail();
 await assert.rejects(deleteOutletServicePoint(f.db,'outlet','existing','current',assigned),/DATABASE FAILURE/);
 assert.deepEqual(f.records,before);assert.deepEqual(f.writes,[]);
});
test('a failed category assignment transaction leaves every product unchanged',async()=>{
 const f=assignmentFixture(),before=structuredClone(f.records);f.fail();
 await assert.rejects(assignCategoryServicePoint(f.db,'outlet','current',assigned,{categoryId:'c1',servicePointId:'existing'}));
 assert.deepEqual(f.records,before);assert.deepEqual(f.writes,[]);
});
