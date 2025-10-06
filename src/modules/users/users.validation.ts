import { z } from "zod";

export const createProfileSchema = z.object({
  fullName: z.string().min(1),
  username: z.string().min(3).max(20),
  gender: z.enum(["male", "female"]),
  dateOfBirth: z.string().transform((val) => new Date(val)),
  bio: z
    .string()
    .max(300)
    .nullable()
    .optional()
    .transform((val) => val ?? null),
  cnicNumber: z.string().regex(/^\d{13}$/),
  skills: z
    .string()
    .transform((val) => JSON.parse(val))
    .nullable()
    .optional()
    .transform((val) => val ?? null),
  phoneNumber: z.string().regex(/^\+92\d{10}$/, {
    message: "Phone number must be in +92XXXXXXXXXX format",
  }),
  address: z.string(),
});
