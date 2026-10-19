fetch('http://localhost:5000/api/abonos/evaluar-deudas', {
  method: 'POST',
  headers: {
    'x-garage-id': 'ebf7eaa0-339e-455f-bcde-dd51636e1f21'
  }
}).then(r => r.json()).then(console.log).catch(console.error);
