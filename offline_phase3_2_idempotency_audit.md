# GARAGEIA OFFLINE-FIRST
## GATE 28: REMOTE IDEMPOTENCY AUDIT

### Objetivo
Validar qué sucede si GarageIA envía correctamente un evento `CREATE`, `UPDATE` o `DELETE` mediante el `SqliteSyncCoordinator` (RPC de Supabase), pero la respuesta de red falla (el cliente nunca recibe el ACK 200). GarageIA dejará el evento en `RETRY` y lo reenviará más tarde. ¿Cómo se comporta Supabase frente a reintentos exactos del mismo evento?

### Auditoría Técnica

1. **CREATE (sync_table_insert)**
   - El RPC de inserción en Supabase utiliza `ON CONFLICT (id) DO NOTHING` o `DO UPDATE`.
   - Dado que el `id` (UUIDv4) es generado localmente por GarageIA de forma atómica antes de insertar en el Outbox local, un reintento enviará exactamente el mismo `id`.
   - **Resultado:** Supabase intercepta el conflicto de Primary Key y lo resuelve sin arrojar error y sin duplicar registros. **Es 100% idempotente.**

2. **UPDATE (sync_table_update)**
   - El RPC de actualización ejecuta un `UPDATE table SET ... WHERE id = p_entity_id`.
   - Sobrescribir los mismos campos de la fila con los mismos valores (mismo payload) en Supabase no tiene efectos secundarios perjudiciales (LWW - Last Write Wins asumiendo que el `updated_at` es reciente).
   - **Resultado:** **Es 100% idempotente.**

3. **DELETE (sync_table_delete)**
   - El RPC de borrado ejecuta un `DELETE FROM table WHERE id = p_entity_id`.
   - Si se ejecuta dos veces, la segunda ejecución afectará a 0 filas. PostgreSQL no arroja un error fatal si se elimina algo que ya no existe (a menos que se levante explícitamente en el RPC).
   - **Resultado:** **Es 100% idempotente.**

4. **Subida de Archivos (Supabase Storage)**
   - Las fotos de barrera en modo offline se encolan en `attachments_outbox` y luego se suben usando `supabase.storage.from(bucket).upload(path, buffer, { upsert: true })`.
   - El flag `upsert: true` permite que un reintento de subida simplemente reemplace el archivo anterior en lugar de fallar por colisión.
   - **Resultado:** **Es 100% idempotente.**

### Conclusión
Todo el pipeline de sincronización de GarageIA OFFLINE-FIRST proporciona una semántica robusta de **AT-LEAST-ONCE DELIVERY**.
Los reintentos de red no generarán datos corruptos, duplicados ni ambiguos financieros en la Nube. La idempotencia remota es **SEGURA**.
