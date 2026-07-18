"use client";
import { useState } from "react";
type Item = { id: string; name: string; price: number; slug: string };
export function AddToCart({ item }: { item: Item }) { const [added, setAdded] = useState(false); function add() { const cart = JSON.parse(localStorage.getItem("idzen_cart") ?? "[]") as Array<Item & { quantity: number }>; const current = cart.find(entry => entry.id === item.id); if (current) current.quantity += 1; else cart.push({ ...item, quantity: 1 }); localStorage.setItem("idzen_cart", JSON.stringify(cart)); setAdded(true); } return <button onClick={add} className="button w-full">{added ? "Added to bag" : "Add to bag"}</button> }
