import { z } from "zod";

export const createProfileSchema = z.object({
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
  phoneNumber: z.string().regex(/^03\d{9}$/, {
    message: "Phone number must start with 03 and be 11 digits long",
  }),
  address: z.string(),
});
