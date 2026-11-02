'use strict';
const assert = require('node:assert/strict');
const {getCategoryKeysForRole} = require('../../config/consultationCategories');
const {assertMayComplete,assertMayEncode,ownedServiceKeys} = require('../../services/medicalRecord/serviceOwnership');
const {canEdit} = require('../../services/medicalRecord/masterlistPresenter');
const admin = {userId:'TEST-ADMIN',role:'admin'};
const forbidden = error => error.statusCode === 403;
for (const service of getCategoryKeysForRole('admin')) {
  assert.throws(()=>assertMayEncode(admin,service),forbidden,`admin cannot encode ${service}`);
  assert.throws(()=>assertMayComplete(admin,service),forbidden,`admin cannot complete ${service}`);
  assert.equal(canEdit({source:'manual_entry',serviceType:service,createdBy:admin.userId},admin),false,'even legacy admin-owned records are read-only');
}
assert.deepEqual(ownedServiceKeys(admin),getCategoryKeysForRole('admin'),'read scope remains all services');
for (const role of ['doctor','midwife','bhw']) {
  const user={userId:`TEST-${role}`,role};
  for (const service of getCategoryKeysForRole(role)) {
    assert.doesNotThrow(()=>assertMayEncode(user,service));
    assert.doesNotThrow(()=>assertMayComplete(user,service));
    assert.equal(canEdit({source:'manual_entry',serviceType:service,createdBy:user.userId},user),true);
  }
}
console.log('Medical record admin read-only and clinical staff ownership passed');
