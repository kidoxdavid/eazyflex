import { asc, eq } from "drizzle-orm";
import { db } from "../db/client";
import { categories, serviceAreas, skills } from "../db/schema";

export const getCategories = () => db.select().from(categories).where(eq(categories.active, true)).orderBy(asc(categories.sortOrder), asc(categories.name));
export const getSkills = () => db.select().from(skills).where(eq(skills.active, true)).orderBy(asc(skills.name));
export const getAreas = () => db.select().from(serviceAreas).where(eq(serviceAreas.active, true)).orderBy(asc(serviceAreas.name));
