with open('src/modules/Garage/infra/GarageController.ts', 'r', encoding='utf-8') as f:
    c = f.read()
c = c.replace('/[`-?]/g', '/[\\\\u0300-\\\\u036f]/g')
with open('src/modules/Garage/infra/GarageController.ts', 'w', encoding='utf-8') as f:
    f.write(c)
