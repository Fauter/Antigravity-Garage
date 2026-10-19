fetch('http://localhost:3000/api/abonos/renovar/preview', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-garage-id': 'ebf7eaa0-339e-455f-bcde-dd51636e1f21'
  },
  body: JSON.stringify({
    targetDebtIds: ['bb19c28a-10b8-54b2-a59c-422a121e57f4'],
    subId: '0e8e00b4-0884-422c-8024-2d0d78f97217',
    basePrice: 100000
  })
}).then(r => r.json()).then(data => console.log(JSON.stringify(data, null, 2))).catch(console.error);
