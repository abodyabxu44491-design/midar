// أدوات مشتركة بين تبويبات الإدارة
import { api } from "/shared/js/api.js";

export const A = "/api/admin";
export const loadClasses = () => api(`${A}/structure/classes`);
export const loadSubjects = () => api(`${A}/structure/subjects`);
export const classOptions = (classes, emptyLabel) => [...(emptyLabel ? [["", emptyLabel]] : []), ...classes.map((c) => [c.id, c.name])];
export const directoryLink = (me) => `${location.origin}/s/${me.school.id}`;
