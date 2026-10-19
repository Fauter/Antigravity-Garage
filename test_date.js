const d = new Date("2026-10-01T02:59:59.999Z");
console.log("Local:", d.toString());
d.setDate(1);
d.setMonth(d.getMonth() + 1);
d.setHours(0,0,0,0);
console.log("EvalDate:", d.toString());
console.log("Now:", new Date().toString());
console.log(d <= new Date());
