fetch('http://localhost:5000/api/abonos/evaluar-deudas', {
  method: 'POST',
  headers: {
    'x-garage-id': '1cffe087-f7aa-4d99-a2c2-b8b46eeaaf02'
  }
}).then(r => r.json()).then(console.log).catch(console.error);
