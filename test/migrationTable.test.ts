import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ensureMigrationTable} from '../src/db/migrationTable.js';
test('existing migration ledger needs no DDL on a read-only connection',async()=>{
 const calls:string[]=[];
 await ensureMigrationTable({query:async(sql)=>{calls.push(sql);if(sql.startsWith('create'))throw Error('read only');return {rows:[{migration_table:'schema_migrations'}]}}});
 assert.equal(calls.length,1);assert.match(calls[0],/^select /);
});
test('missing migration ledger is created',async()=>{
 const calls:string[]=[];
 await ensureMigrationTable({query:async(sql)=>{calls.push(sql);return {rows:[{migration_table:null}]}}});
 assert.equal(calls.length,2);assert.match(calls[1],/^create table if not exists /);
});
test('missing ledger or inaccessible database cannot silently pass',async()=>{
 await assert.rejects(ensureMigrationTable({query:async(sql)=>{if(sql.startsWith('create'))throw Error('read only');return {rows:[{migration_table:null}]}}}),/read only/);
 await assert.rejects(ensureMigrationTable({query:async()=>{throw Error('offline')}}),/offline/);
});
