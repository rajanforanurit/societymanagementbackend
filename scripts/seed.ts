import { UserType } from '../src/common/constants/enums';
import { hashPassword } from '../src/common/utils/password';
import { logger } from '../src/common/utils/logger';
import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { env } from '../src/config/env';
import { User } from '../src/modules/auth/auth.model';
import { Resident } from '../src/modules/resident/resident.model';
import { ensureRoleTemplates } from '../src/modules/roles/roles.service';
import { Flat, Gate, Society, Tower } from '../src/modules/society/society.model';
import { societyAdminService } from '../src/modules/society/society.service';
import { Guard } from '../src/modules/guard/guard.model';
import { Charge } from '../src/modules/payments/payment.model';

async function main() {
  await connectDatabase();
  await ensureRoleTemplates();
  let admin: any = await User.findOne({ userType: UserType.SUPER_ADMIN });
  if (!admin) {
    admin = await User.create({ name: env.SUPER_ADMIN_NAME, email: env.SUPER_ADMIN_EMAIL.toLowerCase(), mobile: env.SUPER_ADMIN_MOBILE, passwordHash: await hashPassword(env.SUPER_ADMIN_PASSWORD), userType: UserType.SUPER_ADMIN, isMobileVerified: true });
    logger.info('super_admin_created', { mobile: env.SUPER_ADMIN_MOBILE });
  } else logger.info('super_admin_exists');

  if (process.argv.includes('--demo')) {
    if (await Society.exists({ code: 'DEMO1' })) {
      logger.info('demo_exists');
    } else {
      const society: any = await societyAdminService.create(
        { name: 'Green Valley Residency', code: 'DEMO1', type: 'GATED_COMMUNITY', address: { city: 'Patna', state: 'Bihar', country: 'India' }, primaryAdmin: { name: 'Demo Admin', mobile: '+919000000001', email: 'admin@demo.test', password: 'Admin@12345' } },
        String(admin._id),
      );
      const sid = String(society._id);
      const tower: any = await Tower.create({ societyId: sid, name: 'A', totalFloors: 5 });
      const flat: any = await Flat.create({ societyId: sid, towerId: tower._id, label: 'A-101', unitNumber: '101', floorNumber: 1, areaSqft: 1100, status: 'OCCUPIED' });
      await Flat.create({ societyId: sid, towerId: tower._id, label: 'A-102', unitNumber: '102', floorNumber: 1, areaSqft: 1100 });
      const gate: any = await Gate.create({ societyId: sid, name: 'Main Gate', type: 'MAIN' });
      const guardUser: any = await User.create({ name: 'Demo Guard', mobile: '+919000000002', passwordHash: await hashPassword('Guard@12345'), userType: UserType.GUARD, isMobileVerified: true });
      await Guard.create({ societyId: sid, userId: guardUser._id, gateId: gate._id, employeeCode: 'G-001' });
      const resUser: any = await User.create({ name: 'Demo Resident', mobile: '+919000000003', email: 'resident@demo.test', passwordHash: await hashPassword('Resident@12345'), userType: UserType.RESIDENT, isMobileVerified: true });
      await Resident.create({ societyId: sid, userId: resUser._id, flatId: flat._id, residentType: 'OWNER', status: 'APPROVED', isPrimary: true, ownershipVerified: true, approvedAt: new Date() });
      await Charge.create({ societyId: sid, name: 'Monthly Maintenance', type: 'MAINTENANCE', amount: 2500, frequency: 'MONTHLY' });
      logger.info('demo_created', { society: 'DEMO1', admin: '+919000000001 / Admin@12345', guard: '+919000000002 / Guard@12345', resident: '+919000000003 / Resident@12345' });
    }
  }
  await disconnectDatabase();
}

main().catch((e) => {
  logger.error('seed_failed', { error: e.message });
  process.exit(1);
});
