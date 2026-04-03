import { Request, Response, NextFunction } from "express";

export class ApiError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

export const globalErrorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
  const statusCode = err.statusCode || 500;
  const message = err.message || "An unexpected error occurred";

  console.error(`[${statusCode}] Error:`, message);
  console.error("Error Details:", err);

  if (err.name === "ValidationError") {
    const errors = Object.values(err.errors).map((e: any) => e.message).join(", ");
    return res.status(400).json({ success: false, message: "Validation error", errors: [errors] });
  }

  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern)[0];
    return res.status(409).json({ success: false, message: `${field} already exists` });
  }

  return res.status(statusCode).json({ success: false, message });
};

export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) =>
  (req: Request, res: Response, next: NextFunction) =>
    Promise.resolve(fn(req, res, next)).catch(next);