fetch('http://localhost:5000/api/abonos/hydration', {
  headers: {
    'x-garage-id': '1cffe087-f7aa-4d99-a2c2-b8b46eeaaf02'
  }
}).then(r => r.json()).then(data => {
  const debts = data.debts.filter(d => d.customerId === '6469d975-e753-47d2-b8e5-f5be42ac7028' || d.customer_id === '6469d975-e753-47d2-b8e5-f5be42ac7028');
  console.log("Debts for customer:", debts);
}).catch(console.error);
