import assert from 'node:assert/strict';
import test from 'node:test';
import { Flat, Society, Tower } from '../src/modules/society/society.model';
import { societyMineService } from '../src/modules/society/society.service';

test('guard directory includes flats from older societies with no layout settings', async (t) => {
  const societyId = '507f1f77bcf86cd799439011';
  const towerId = '507f1f77bcf86cd799439012';
  const flatId = '507f1f77bcf86cd799439013';
  const houseId = '507f1f77bcf86cd799439014';

  t.mock.method(Society, 'findById', (id: string) => {
    assert.equal(id, societyId);
    return { select: () => Promise.resolve({ toJSON: () => ({ name: 'Demo' }) }) };
  });
  t.mock.method(Tower, 'find', (filter: object) => {
    assert.deepEqual(filter, { societyId });
    return { select: () => ({ sort: () => ({ lean: async () => [{ _id: towerId, name: 'Tower A' }] }) }) };
  });
  t.mock.method(Flat, 'find', (filter: object) => {
    assert.deepEqual(filter, { societyId });
    return {
      select: () => ({
        sort: () => ({
          lean: async () => [
            { _id: flatId, towerId, label: 'A-101', ownerResidentId: 'private' },
            { _id: houseId, label: 'Villa 1' },
          ],
        }),
      }),
    };
  });

  const info = await societyMineService.guardPropertyInfo(societyId);
  assert.deepEqual(info.gateDirectory, [
    { name: 'Tower A', flats: [{ id: flatId, label: 'A-101' }] },
    { name: 'Other units', flats: [{ id: houseId, label: 'Villa 1' }] },
  ]);
});

test('guard app screens have guard-only routes', async () => {
  const { registeredOperations } = await import('../src/common/openapi/registry.js');
  await import('../src/routes.js');

  for (const [method, route] of [
    ['get', 'society-info'],
    ['get', 'lost-found'],
    ['get', 'incidents'],
    ['get', 'profile'],
    ['patch', 'profile'],
    ['put', 'notification-preferences'],
  ]) {
    const operation = registeredOperations().find(
      (op) => op.method === method && op.path === `/api/v1/guard/${route}`,
    );
    assert.ok(operation, `Missing ${method} guard/${route}`);
    assert.equal(operation.auth, true);
    assert.deepEqual(operation.roles, ['GUARD']);
  }
});
