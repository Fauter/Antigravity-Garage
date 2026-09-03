    it('GATE G: Crash during PROCESSING recovery', async () => {
        db.prepare(`INSERT INTO outbox_events (event_id, entity_type, entity_id, operation, payload, status, created_at, updated_at, sequence, attempts) 
            VALUES ('e6', 'Customer', 'c6', 'CREATE', '{}', 'PROCESSING', ?, ?, 105, 0)`).run(new Date().toISOString(), new Date().toISOString());
        
        // Simulating restart
        const newCoord = new SqliteSyncCoordinator(); 
        
        const row = db.prepare('SELECT status FROM outbox_events WHERE sequence = 105').get();
        expect(row.status).toBe('PENDING'); // Recovered!
    });
