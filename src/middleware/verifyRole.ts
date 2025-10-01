import { type NextFunction, type Request, type Response } from "express";

type Role = "user" | "admin";

export const verifyRole = (roles: Role[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const role = req.role as Role | undefined;
    if (!role || !roles.includes(role)) {
      console.error("Forbidden");
      return res.status(403).json({ error: "Forbidden" });
    }
    next();
  };
};
