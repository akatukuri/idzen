export type Role = "CUSTOMER" | "ADMIN";
export type ApiUser = { id: string; email: string; name: string; role: Role };
export type ApiResponse<T> = { data: T; message?: string };
