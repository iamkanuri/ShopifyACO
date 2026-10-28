import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sameAdminOrigin, isAdmin, adminWriteBoundary} from '../src/server/admin.js';
import type {Request, Response} from 'express';

test('admin writes accept only the exact configured origin',()=>{
  const expected='https://lens.thirdocular.com';
  assert.equal(sameAdminOrigin(expected,expected),true);
  assert.equal(sameAdminOrigin(expected+':443',expected),true);
  for(const origin of [undefined,'null','https://thirdocular.com','https://evil.example','http://lens.thirdocular.com','https://lens.thirdocular.com.evil.example','https://evil@lens.thirdocular.com','https://lens.thirdocular.com/path'])
    assert.equal(sameAdminOrigin(origin,expected),false,origin);
  assert.equal(sameAdminOrigin(expected,undefined),false);
});
test('malformed percent encoded cookies fail closed',()=>{
  assert.equal(isAdmin({headers:{cookie:'aco_admin=%E0%A4%A'}} as Request),false);
});
test('missing-origin admin POST is denied before handler',()=>{
  let code=0,called=false;
  const req={method:'POST',protocol:'https',get:(h:string)=>h==='host'?'lens.thirdocular.com':undefined} as Request;
  const res={setHeader:()=>{},status:(n:number)=>{code=n;return res},json:()=>{}} as unknown as Response;
  adminWriteBoundary(req,res,()=>{called=true});
  assert.equal(code,403);assert.equal(called,false);
});
