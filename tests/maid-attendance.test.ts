import assert from 'node:assert/strict';
import test from 'node:test';
import { registeredOperations } from '../src/common/openapi/registry';
import { attendanceClock, attendanceDateFilter, calendarDays, firstCheckIns, type GateEntry } from '../src/modules/domestic-help/attendance-calendar';
import { DomesticAttendance, DomesticHelp } from '../src/modules/domestic-help/domestic.model';
import { attendanceCalendarQuery, guardHelpGateBody, registerMaidBody } from '../src/modules/domestic-help/domestic.schema';
import { domesticService } from '../src/modules/domestic-help/domestic.service';
import { Resident } from '../src/modules/resident/resident.model';
import { Society } from '../src/modules/society/society.model';

const societyId = '507f1f77bcf86cd799439011';
const helpId = '507f1f77bcf86cd799439012';
const flatId = '507f1f77bcf86cd799439013';
const guardId = '507f1f77bcf86cd799439014';

test('calendar groups legacy gate entries by local date and excludes check-ins before assignment', () => {
  const { dateOf } = attendanceClock('Asia/Kolkata');
  const since = new Date('2026-11-23T21:00:00Z');
  const entries = [
    { checkInAt: new Date('2026-11-25T06:00:00Z') },
    { checkInAt: new Date('2026-11-24T19:00:00Z'), checkOutAt: new Date('2026-11-24T22:00:00Z') },
    { checkInAt: new Date('2026-11-23T20:00:00Z') },
  ];
  const firstByDate = firstCheckIns(entries, dateOf, since);
  assert.deepEqual(attendanceDateFilter('2026-11-25'), { $gte: '2026-11-24', $lte: '2026-11-26' });
  assert.deepEqual(calendarDays('2026-11-23', '2026-11-27', '2026-11-26', dateOf(since), firstByDate), [
    { date: '2026-11-23', status: 'NOT_APPLICABLE' },
    { date: '2026-11-24', status: 'ABSENT' },
    { date: '2026-11-25', status: 'PRESENT', firstCheckInAt: '2026-11-24T19:00:00.000Z' },
    { date: '2026-11-26', status: 'PENDING' },
    { date: '2026-11-27', status: 'NOT_APPLICABLE' },
  ]);
});

test('maid request schemas require a photo and six digits and support a leap year', () => {
  assert.equal(registerMaidBody.safeParse({ name: 'Maid', mobile: '9555555555' }).success, false);
  assert.deepEqual(guardHelpGateBody.parse({ code: '001234' }), { code: '001234' });
  assert.equal(guardHelpGateBody.safeParse({ code: 123456 }).success, false);
  assert.equal(attendanceCalendarQuery.safeParse({ flatId, from: '2024-01-01', to: '2024-12-31' }).success, true);
  assert.equal(attendanceCalendarQuery.safeParse({ flatId, from: '2024-01-01', to: '2025-01-01' }).success, false);
  assert.equal(attendanceCalendarQuery.safeParse({ flatId, from: '2024-01-01' }).success, false);
});

test('a newly registered maid can be marked once, including concurrent submissions', async (t) => {
  const now = new Date('2026-11-24T19:00:00Z');
  t.mock.timers.enable({ apis: ['Date'], now });
  t.mock.method(DomesticHelp, 'findOne', (filter: object) => {
    assert.deepEqual(filter, { societyId, code: '001234', helpType: 'MAID' });
    return Promise.resolve({ _id: helpId, name: 'Maid', helpType: 'MAID', status: 'PENDING_VERIFICATION', allowPendingGateAttendance: true, flats: [{ flatId }] });
  });
  t.mock.method(Society, 'findById', () => ({ select: () => ({ lean: async () => ({ settings: { timezone: 'Asia/Kolkata' } }) }) }));
  const entries: GateEntry[] = [];
  t.mock.method(DomesticAttendance, 'find', (filter: object) => {
    assert.deepEqual(filter, { societyId, helpId, date: { $gte: '2026-11-24', $lte: '2026-11-26' } });
    return { select: () => ({ lean: async () => [{ entries: [...entries] }] }) };
  });
  t.mock.method(Resident, 'find', () => ({ select: async () => [] }));
  t.mock.method(DomesticAttendance, 'updateOne', async (filter: any, update: any) => {
    assert.equal(filter.societyId, societyId);
    assert.equal(filter.helpId, helpId);
    assert.equal(filter.date, '2026-11-25');
    if (update.$setOnInsert) return { modifiedCount: 0 };
    assert.ok(filter.$expr.$not);
    if (entries.length) return { modifiedCount: 0 };
    assert.deepEqual(update.$push.entries, { gateId: undefined, checkInAt: now, markedBy: guardId });
    entries.push(update.$push.entries);
    return { modifiedCount: 1 };
  });

  const actor = { societyId, userId: guardId };
  const results = await Promise.all([
    domesticService.markMaidAttendance(actor, '001234'),
    domesticService.markMaidAttendance(actor, '001234'),
  ]);
  assert.deepEqual(results.map((result) => result.alreadyMarked).sort(), [false, true]);
  assert.equal(entries.length, 1);
  assert.ok(results.every((result) => result.firstCheckInAt === now.toISOString()));
});

test('old pending and suspended profiles cannot be marked and unrelated residents cannot read the calendar', async (t) => {
  for (const [status, allowPendingGateAttendance] of [['PENDING_VERIFICATION', false], ['SUSPENDED', true]]) {
    t.mock.method(DomesticHelp, 'findOne', async () => ({ _id: helpId, helpType: 'MAID', status, allowPendingGateAttendance, flats: [{ flatId }] }));
    await assert.rejects(domesticService.markMaidAttendance({ societyId, userId: guardId }, '001234'), { code: 'HELP_NOT_VERIFIED' });
    t.mock.restoreAll();
  }
  await assert.rejects(domesticService.attendanceCalendar(societyId, [], helpId, { flatId }), { code: 'FLAT_FORBIDDEN' });
});

test('maid routes are scoped to the appropriate authenticated role and feature', async () => {
  await import('../src/routes.js');
  for (const [method, path, role] of [
    ['post', '/api/v1/user/domestic-help/maids', 'RESIDENT'],
    ['get', '/api/v1/user/domestic-help/:id/attendance/calendar', 'RESIDENT'],
    ['post', '/api/v1/guard/domestic-help/attendance', 'GUARD'],
  ]) {
    const operation = registeredOperations().find((op) => op.method === method && op.path === path);
    assert.ok(operation);
    assert.equal(operation.auth, true);
    assert.equal(operation.feature, 'domesticHelp');
    assert.deepEqual(operation.roles, [role]);
  }
});
