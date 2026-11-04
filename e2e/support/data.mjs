/*!
 * Midar (مدار) - School Management Platform
 * Copyright (c) 2026 Midar. All rights reserved.
 * Proprietary and confidential. Unauthorized copying or distribution is prohibited.
 */
// Test people with Arabic names (Faker). Phones start with 000 and emails end in .test, so no generated value can
// belong to a real person or reach a real inbox.
import { fakerAR as faker } from "@faker-js/faker";

const digits = (n) => faker.string.numeric({ length: n, allowLeadingZeros: true });
export const uid = () => faker.string.alphanumeric({ length: 6, casing: "lower" });
export const testEmail = (tag = "u") => `${tag}.${uid()}${uid()}@school.test`;
export const testPhone = () => `000${digits(6)}`;
export const personName = (sex = "male") => `${faker.person.firstName(sex)} ${faker.person.firstName("male")} ${faker.person.lastName()}`;
export const student = () => ({ name: personName(faker.helpers.arrayElement(["male", "female"])), guardian_phone: testPhone() });
export const password = () => `Midar-${uid()}-${digits(4)}`;
