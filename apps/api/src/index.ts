import "dotenv/config";
import bcrypt from "bcryptjs";
import cors from "cors";
import express, { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import morgan from "morgan";
import Razorpay from "razorpay";
import { PrismaClient, Role } from "@prisma/client";
import { z } from "zod";

const prisma = new PrismaClient();
const app = express();
const port = Number(process.env.API_PORT ?? 4000);
const secret = process.env.JWT_SECRET;
if (!secret) throw new Error("JWT_SECRET must be configured");
app.use(cors({ origin: process.env.WEB_ORIGIN?.split(",") ?? "http://localhost:3000", credentials: true }));
app.use(express.json());
app.use(morgan("tiny"));

type AuthRequest = Request & { user?: { id: string; role: Role } };
const signToken = (user: { id: string; email: string; name: string; role: Role }) => jwt.sign({ sub: user.id, email: user.email, name: user.name, role: user.role }, secret, { expiresIn: "7d" });
const auth = (roles?: Role[]) => (req: AuthRequest, res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ message: "Authentication required" });
  try { const payload = jwt.verify(token, secret) as jwt.JwtPayload; if (!payload.sub || !payload.role) throw new Error(); req.user = { id: payload.sub, role: payload.role as Role }; if (roles && !roles.includes(req.user.role)) return res.status(403).json({ message: "Insufficient permissions" }); next(); } catch { res.status(401).json({ message: "Invalid or expired token" }); }
};
const asyncRoute = (fn: (req: any, res: Response) => Promise<void>) => (req: Request, res: Response, next: NextFunction) => void fn(req, res).catch(next);
const productInput = z.object({ name: z.string().min(2), slug: z.string().min(2), description: z.string().min(10), price: z.number().int().positive(), compareAtPrice: z.number().int().positive().nullable().optional(), stock: z.number().int().min(0), images: z.array(z.string().url()).default([]), categoryId: z.string() });

app.get("/api/health", (_req, res) => res.json({ data: { status: "ok", service: "idzen-api" } }));
app.post("/api/auth/register", asyncRoute(async (req, res) => {
  const input = z.object({ name: z.string().min(2), email: z.string().email(), password: z.string().min(8) }).parse(req.body);
  const existing = await prisma.user.findUnique({ where: { email: input.email } }); if (existing) { res.status(409).json({ message: "Email already registered" }); return; }
  const user = await prisma.user.create({ data: { name: input.name, email: input.email, passwordHash: await bcrypt.hash(input.password, 12) } });
  res.status(201).json({ data: { token: signToken(user), user: { id: user.id, name: user.name, email: user.email, role: user.role } } });
}));
app.post("/api/auth/login", asyncRoute(async (req, res) => {
  const input = z.object({ email: z.string().email(), password: z.string() }).parse(req.body); const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user?.passwordHash || !(await bcrypt.compare(input.password, user.passwordHash))) { res.status(401).json({ message: "Invalid email or password" }); return; }
  res.json({ data: { token: signToken(user), user: { id: user.id, name: user.name, email: user.email, role: user.role } } });
}));
app.post("/api/auth/otp/request", asyncRoute(async (req, res) => { const { email } = z.object({ email: z.string().email() }).parse(req.body); const code = String(Math.floor(100000 + Math.random() * 900000)); await prisma.otp.create({ data: { email, code, expiresAt: new Date(Date.now() + 10 * 60_000) } }); if (process.env.NODE_ENV !== "production") console.info(`OTP for ${email}: ${code}`); res.status(202).json({ message: "Verification code sent" }); }));
app.post("/api/auth/otp/verify", asyncRoute(async (req, res) => { const { email, code, name } = z.object({ email: z.string().email(), code: z.string().length(6), name: z.string().min(2).default("idzen customer") }).parse(req.body); const otp = await prisma.otp.findFirst({ where: { email, code, expiresAt: { gt: new Date() }, userId: null }, orderBy: { createdAt: "desc" } }); if (!otp) { res.status(400).json({ message: "Invalid or expired code" }); return; } const user = await prisma.user.upsert({ where: { email }, create: { email, name }, update: {} }); await prisma.otp.update({ where: { id: otp.id }, data: { userId: user.id } }); res.json({ data: { token: signToken(user), user } }); }));

app.get("/api/products", asyncRoute(async (req, res) => { const q = String(req.query.q ?? ""); const category = req.query.category ? String(req.query.category) : undefined; const products = await prisma.product.findMany({ where: { isActive: true, ...(category ? { category: { slug: category } } : {}), ...(q ? { OR: [{ name: { contains: q } }, { description: { contains: q } }] } : {}) }, include: { category: true, reviews: { where: { isApproved: true }, select: { rating: true } } }, orderBy: { createdAt: "desc" } }); res.json({ data: products }); }));
app.get("/api/products/:slug", asyncRoute(async (req, res) => { const product = await prisma.product.findUnique({ where: { slug: req.params.slug }, include: { category: true, reviews: { where: { isApproved: true }, include: { user: { select: { name: true } } } } } }); if (!product || !product.isActive) { res.status(404).json({ message: "Product not found" }); return; } res.json({ data: product }); }));
app.post("/api/products", auth([Role.ADMIN]), asyncRoute(async (req: AuthRequest, res) => { const input = productInput.parse(req.body); const product = await prisma.product.create({ data: { ...input, images: JSON.stringify(input.images) } }); res.status(201).json({ data: product }); }));
app.patch("/api/products/:id", auth([Role.ADMIN]), asyncRoute(async (req, res) => { const input = productInput.partial().parse(req.body); const product = await prisma.product.update({ where: { id: req.params.id }, data: { ...input, ...(input.images ? { images: JSON.stringify(input.images) } : {}) } }); res.json({ data: product }); }));
app.post("/api/categories", auth([Role.ADMIN]), asyncRoute(async (req, res) => { const input = z.object({ name: z.string().min(2), slug: z.string().min(2) }).parse(req.body); res.status(201).json({ data: await prisma.category.create({ data: input }) }); }));
app.get("/api/admin/orders", auth([Role.ADMIN]), asyncRoute(async (_req, res) => { res.json({ data: await prisma.order.findMany({ include: { user: { select: { name: true, email: true } }, items: true }, orderBy: { createdAt: "desc" } }) }); }));
app.patch("/api/admin/orders/:id/status", auth([Role.ADMIN]), asyncRoute(async (req, res) => { const { status } = z.object({ status: z.enum(["PENDING", "PAID", "PROCESSING", "SHIPPED", "DELIVERED", "CANCELLED"]) }).parse(req.body); res.json({ data: await prisma.order.update({ where: { id: req.params.id }, data: { status } }) }); }));
app.post("/api/coupons", auth([Role.ADMIN]), asyncRoute(async (req, res) => { const input = z.object({ code: z.string().min(3).transform(value => value.toUpperCase()), percentage: z.number().int().min(1).max(100).optional(), amount: z.number().int().positive().optional(), minOrderAmount: z.number().int().positive().optional(), startsAt: z.coerce.date(), endsAt: z.coerce.date(), maxUses: z.number().int().positive().optional() }).refine(value => Boolean(value.percentage) !== Boolean(value.amount), "Provide exactly one discount type").parse(req.body); res.status(201).json({ data: await prisma.coupon.create({ data: input }) }); }));

app.post("/api/orders", auth(), asyncRoute(async (req: AuthRequest, res) => { const input = z.object({ items: z.array(z.object({ productId: z.string(), quantity: z.number().int().positive() })).min(1), addressId: z.string().optional(), couponCode: z.string().optional() }).parse(req.body); const products = await prisma.product.findMany({ where: { id: { in: input.items.map(i => i.productId) }, isActive: true } }); if (products.length !== input.items.length) { res.status(400).json({ message: "One or more products are unavailable" }); return; } const subtotal = input.items.reduce((sum, item) => { const product = products.find(p => p.id === item.productId)!; if (product.stock < item.quantity) throw new Error(`${product.name} is out of stock`); return sum + product.price * item.quantity; }, 0); let discount = 0; if (input.couponCode) { const coupon = await prisma.coupon.findUnique({ where: { code: input.couponCode } }); if (coupon && coupon.isActive && coupon.startsAt <= new Date() && coupon.endsAt >= new Date() && (!coupon.minOrderAmount || subtotal >= coupon.minOrderAmount)) discount = coupon.amount ?? Math.floor(subtotal * (coupon.percentage ?? 0) / 100); } const order = await prisma.$transaction(async tx => { const made = await tx.order.create({ data: { orderNumber: `IDZ-${Date.now()}`, subtotal, discount, total: Math.max(0, subtotal - discount), couponCode: input.couponCode, addressId: input.addressId, userId: req.user!.id, items: { create: input.items.map(item => ({ productId: item.productId, quantity: item.quantity, price: products.find(p => p.id === item.productId)!.price })) } }, include: { items: true } }); for (const item of input.items) await tx.product.update({ where: { id: item.productId }, data: { stock: { decrement: item.quantity } } }); return made; }); let payment: unknown = null; if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) { const razorpay = new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET }); payment = await razorpay.orders.create({ amount: order.total, currency: "INR", receipt: order.orderNumber }); await prisma.order.update({ where: { id: order.id }, data: { razorpayOrderId: (payment as { id: string }).id } }); } res.status(201).json({ data: { order, payment } }); }));
app.get("/api/orders/me", auth(), asyncRoute(async (req: AuthRequest, res) => { res.json({ data: await prisma.order.findMany({ where: { userId: req.user!.id }, include: { items: { include: { product: true } } }, orderBy: { createdAt: "desc" } }) }); }));
app.post("/api/products/:id/reviews", auth(), asyncRoute(async (req: AuthRequest, res) => { const input = z.object({ rating: z.number().int().min(1).max(5), title: z.string().max(80).optional(), body: z.string().max(1000).optional() }).parse(req.body); const review = await prisma.review.upsert({ where: { userId_productId: { userId: req.user!.id, productId: req.params.id } }, create: { ...input, userId: req.user!.id, productId: req.params.id }, update: input }); res.status(201).json({ data: review }); }));
app.get("/api/admin/reports/overview", auth([Role.ADMIN]), asyncRoute(async (_req, res) => { const [orders, customers, products, revenue] = await Promise.all([prisma.order.count(), prisma.user.count({ where: { role: Role.CUSTOMER } }), prisma.product.count(), prisma.order.aggregate({ _sum: { total: true }, where: { paymentStatus: "PAID" } })]); res.json({ data: { orders, customers, products, revenue: revenue._sum.total ?? 0 } }); }));
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => { console.error(error); if (error instanceof z.ZodError) return res.status(400).json({ message: "Invalid request", issues: error.issues }); res.status(500).json({ message: "Something went wrong" }); });
app.listen(port, () => console.log(`idzen API listening on :${port}`));
