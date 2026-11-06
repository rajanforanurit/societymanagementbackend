import { logger } from '../common/utils/logger';
import { complaintService } from '../modules/complaints/complaint.service';
import { amenityExtra } from '../modules/amenities/amenity.service';
import { marketplaceService } from '../modules/marketplace/marketplace.routes';
import { propertyService } from '../modules/property/property.routes';
import { runOverdueAndPenalties, sendPaymentReminders } from '../modules/payments/payment.service';
import { visitorService } from '../modules/visitors/visitor.service';
import { schedulerState } from './state';

const minuteJobs: [string, () => Promise<unknown>][] = [
  ['visitor_timeouts', () => visitorService.processTimeouts()],
  ['expire_marketplace', () => marketplaceService.expireDue()],
  ['expire_property', () => propertyService.expireDue()],
  ['escalate_complaints', () => complaintService.escalateOverdue()],
  ['complete_bookings', () => amenityExtra.completePast()],
];
const hourlyJobs: [string, () => Promise<unknown>][] = [
  ['overdue_and_penalties', () => runOverdueAndPenalties()],
  ['payment_reminders', () => sendPaymentReminders()],
  ['booking_reminders', () => amenityExtra.sendReminders()],
];

const guarded = (jobs: [string, () => Promise<unknown>][]) => {
  let running = false;
  return async () => {
    if (running) return;
    running = true;
    for (const [name, fn] of jobs) {
      try {
        await fn();
      } catch (err) {
        schedulerState.lastError = `${name}: ${(err as Error).message}`;
        logger.error('job_failed', { job: name, error: (err as Error).message });
      }
    }
    schedulerState.lastRunAt = new Date();
    running = false;
  };
};

export function startScheduler() {
  const minute = guarded(minuteJobs);
  const hourly = guarded(hourlyJobs);
  const t1 = setInterval(minute, 60 * 1000);
  const t2 = setInterval(hourly, 60 * 60 * 1000);
  t1.unref();
  t2.unref();
  setTimeout(() => void hourly(), 30 * 1000).unref();
  logger.info('scheduler_started');
  return () => {
    clearInterval(t1);
    clearInterval(t2);
  };
}
