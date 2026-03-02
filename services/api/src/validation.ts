import { z } from 'zod';

export const submitFlightRequestSchema = z.object({
  airport_id: z.string().min(3).max(10),
  flight_id: z.string().min(2).max(32),
  airline_id: z.string().min(2).max(32),
  scheduled_arrival_time: z.string().datetime(),
  aircraft_type: z.string().min(2).max(32),
  priority: z.enum(['NORMAL', 'INTERNATIONAL', 'EMERGENCY']),
  constraints: z
    .object({
      maxDelayMinutes: z.number().int().min(0).max(240).optional(),
      preferredRunwayId: z.string().max(32).optional()
    })
    .optional()
});

export const delayUpdateSchema = z.object({
  airport_id: z.string().min(3).max(10),
  new_arrival_time: z.string().datetime(),
  delay_reason: z.string().min(2).max(256)
});

export const capacityUpdateSchema = z.object({
  airport_id: z.string().min(3).max(10),
  runway_count: z.number().int().min(1).max(8),
  slot_minutes: z.number().int().min(1).max(30),
  lookahead_minutes: z.number().int().min(15).max(360),
  holding_lookahead_minutes: z.number().int().min(5).max(360),
  max_consecutive_per_airline: z.number().int().min(1).max(10),
  freeze_window_minutes: z.number().int().min(0).max(60)
});
