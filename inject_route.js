const fs = require('fs');
let content = fs.readFileSync('src/infrastructure/http/server.ts', 'utf-8');

const target = `        app.get('/api/estadias/recientes', async (req, res) => {
            try {
                const garageId = (req.headers['x-garage-id'] as string);
                if (!garageId) return res.status(400).json({ error: 'x-garage-id header required' });

                const allStays: any[] = await (require('../database/sqlite/SQLiteManager').SQLiteManager.getInstance().getDatabase().prepare("SELECT json_data FROM stays WHERE json_extract(json_data, '$.garageId') = ?").all(garageId).map((r: any) => JSON.parse(r.json_data)));
                const sorted = allStays
                    .sort((a: any, b: any) => new Date(b.entryTime).getTime() - new Date(a.entryTime).getTime())
                    .slice(0, 20);

                res.json(sorted);
            } catch (error: any) {
                console.error('Error fetching recent stays:', error);
                res.status(500).json({ error: error.message });
            }
        });`;

const replacement = target + `

        // Reprint Center API
        app.get('/api/reimpresion/buscar', async (req, res) => {
            try {
                const garageId = (req.headers['x-garage-id'] as string);
                if (!garageId) return res.status(400).json({ error: 'x-garage-id header required' });
                
                const limit = parseInt(req.query.limit as string) || 100;
                const offset = parseInt(req.query.offset as string) || 0;
                const search = req.query.search ? (req.query.search as string).toLowerCase().trim() : '';
                
                const sqlite = require('../database/sqlite/SQLiteManager').SQLiteManager.getInstance().getDatabase();
                
                // 1. Fetch Stays
                let staysQuery = "SELECT json_data FROM stays WHERE (json_extract(json_data, '$.garageId') = ? OR json_extract(json_data, '$.garage_id') = ?)";
                const staysParams: any[] = [garageId, garageId];
                
                if (search) {
                    staysQuery += " AND (LOWER(json_extract(json_data, '$.plate')) LIKE ? OR LOWER(json_extract(json_data, '$.ticket_code')) LIKE ?)";
                    staysParams.push(\`%\${search}%\`, \`%\${search}%\`);
                }
                staysQuery += " ORDER BY json_extract(json_data, '$.entryTime') DESC LIMIT ? OFFSET ?";
                staysParams.push(limit, offset);
                
                const stays = sqlite.prepare(staysQuery).all(...staysParams).map((r: any) => JSON.parse(r.json_data));
                
                // 2. Fetch Movements
                let movsQuery = "SELECT json_data FROM movements WHERE (json_extract(json_data, '$.garageId') = ? OR json_extract(json_data, '$.garage_id') = ?)";
                const movsParams: any[] = [garageId, garageId];
                
                movsQuery += " AND json_extract(json_data, '$.type') IN ('CobroEstadia', 'CobroAbono', 'Upgrade')";
                
                if (search) {
                    movsQuery += " AND (LOWER(json_extract(json_data, '$.plate')) LIKE ? OR LOWER(json_extract(json_data, '$.ticket_code')) LIKE ?)";
                    movsParams.push(\`%\${search}%\`, \`%\${search}%\`);
                }
                movsQuery += " ORDER BY json_extract(json_data, '$.timestamp') DESC LIMIT ? OFFSET ?";
                movsParams.push(limit, offset);
                
                const movements = sqlite.prepare(movsQuery).all(...movsParams).map((r: any) => JSON.parse(r.json_data));
                
                // 3. For all movements that are CobroEstadia, fetch their related stay
                const stayIdsToFetch = new Set<string>();
                movements.forEach((m: any) => {
                    if (m.type === 'CobroEstadia' && m.relatedEntityId) {
                        stayIdsToFetch.add(m.relatedEntityId);
                    } else if (m.type === 'CobroEstadia' && m.related_entity_id) {
                        stayIdsToFetch.add(m.related_entity_id);
                    }
                });
                
                stays.forEach((s: any) => {
                    stayIdsToFetch.delete(s.id);
                    stayIdsToFetch.delete(s._id);
                });
                
                const extraStays: any[] = [];
                if (stayIdsToFetch.size > 0) {
                    const placeholders = Array.from(stayIdsToFetch).map(() => '?').join(',');
                    const extraQuery = \`SELECT json_data FROM stays WHERE json_extract(json_data, '$.id') IN (\${placeholders}) OR json_extract(json_data, '$._id') IN (\${placeholders})\`;
                    const params = [...Array.from(stayIdsToFetch), ...Array.from(stayIdsToFetch)];
                    const extra = sqlite.prepare(extraQuery).all(...params).map((r: any) => JSON.parse(r.json_data));
                    extraStays.push(...extra);
                }
                
                const allStaysToMap = [...stays, ...extraStays];
                const stayMap = new Map();
                allStaysToMap.forEach(s => {
                    stayMap.set(s.id || s._id, s);
                });
                
                // 4. Also, for stays that are "prepaid", fetch their prepaid_movement_id
                const movIdsToFetch = new Set<string>();
                stays.forEach((s: any) => {
                    if (s.is_prepaid && s.prepaid_movement_id) {
                        movIdsToFetch.add(s.prepaid_movement_id);
                    }
                });
                
                movements.forEach((m: any) => movIdsToFetch.delete(m.id));
                const extraMovs: any[] = [];
                if (movIdsToFetch.size > 0) {
                    const placeholders = Array.from(movIdsToFetch).map(() => '?').join(',');
                    const extraQuery = \`SELECT json_data FROM movements WHERE json_extract(json_data, '$.id') IN (\${placeholders})\`;
                    const extra = sqlite.prepare(extraQuery).all(...Array.from(movIdsToFetch)).map((r: any) => JSON.parse(r.json_data));
                    extraMovs.push(...extra);
                }
                const allMovsToMap = [...movements, ...extraMovs];
                const movMap = new Map();
                allMovsToMap.forEach(m => {
                    movMap.set(m.id, m);
                });
                
                // 5. Construct unified list
                const items: any[] = [];
                const seenIds = new Set<string>();
                
                for (const stay of stays) {
                    const stayId = stay.id || stay._id || '';
                    if (!stayId || seenIds.has(\`entry-\${stayId}\`)) continue;
                    
                    items.push({
                        id: \`entry-\${stayId}\`,
                        type: 'Entrada',
                        plate: stay.plate,
                        timestamp: stay.entryTime,
                        _stay: stay,
                        _movement: stay.is_prepaid && stay.prepaid_movement_id ? movMap.get(stay.prepaid_movement_id) : undefined
                    });
                    seenIds.add(\`entry-\${stayId}\`);
                }
                
                for (const mov of movements) {
                    const movId = mov.id || '';
                    if (!movId) continue;
                    
                    if (mov.type === 'CobroEstadia') {
                        if (seenIds.has(\`exit-\${movId}\`)) continue;
                        const relatedId = mov.relatedEntityId || mov.related_entity_id;
                        const relatedStay = relatedId ? stayMap.get(relatedId) : undefined;
                        
                        items.push({
                            id: \`exit-\${movId}\`,
                            type: 'CobroEstadia',
                            plate: mov.plate,
                            timestamp: mov.timestamp,
                            amount: mov.amount,
                            paymentMethod: mov.paymentMethod || mov.payment_method,
                            operator: mov.operator,
                            notes: mov.notes,
                            _stay: relatedStay,
                            _movement: mov
                        });
                        seenIds.add(\`exit-\${movId}\`);
                    } else if (mov.type === 'CobroAbono' || mov.type === 'Upgrade') {
                        if (seenIds.has(\`abono-\${movId}\`)) continue;
                        items.push({
                            id: \`abono-\${movId}\`,
                            type: mov.type,
                            plate: mov.plate,
                            timestamp: mov.timestamp,
                            amount: mov.amount,
                            paymentMethod: mov.paymentMethod || mov.payment_method,
                            operator: mov.operator,
                            notes: mov.notes,
                            _movement: mov
                        });
                        seenIds.add(\`abono-\${movId}\`);
                    }
                }
                
                items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
                
                const finalItems = items.slice(0, limit);
                res.json(finalItems);
                
            } catch (error: any) {
                console.error('Error in /api/reimpresion/buscar:', error);
                res.status(500).json({ error: error.message });
            }
        });`;

if (content.includes(target)) {
    content = content.replace(target, replacement);
    fs.writeFileSync('src/infrastructure/http/server.ts', content);
    console.log("Success");
} else {
    console.log("Target not found");
}
