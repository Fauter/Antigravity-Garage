(async () => {
  const now = new Date();
  const subEndDate = new Date("2026-10-01T02:59:59.999Z");
  console.log("subEndDate:", subEndDate);
  let currentEvalDate = new Date(subEndDate.getTime());
  currentEvalDate.setDate(1);
  currentEvalDate.setMonth(currentEvalDate.getMonth() + 1);
  currentEvalDate.setHours(0, 0, 0, 0);

  console.log("currentEvalDate:", currentEvalDate);
  console.log("now:", now);
  console.log("currentEvalDate <= now:", currentEvalDate <= now);
})();
