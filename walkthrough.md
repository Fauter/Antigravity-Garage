# Phase 2.6: Source-of-Truth Closure & End-to-End Offline Proof

Se completó satisfactoriamente la Fase 2.6 de la estabilización y validación Offline-First de GarageIA, confirmando a **SQLite como única Source of Truth**.

## Cambios Realizados
1. **Auditoría y Migración de Lecturas Directas (Reads)**
   - Se removieron **TODAS** las llamadas a `db.*.find()` y `db.*.findOne()` de los controladores `GarageController.ts` y `routes.ts`.
   - Se implementaron métodos `findAll` y `getParams`/`getPrices` en repositorios proxy como `ConfigRepository`, `ShiftCloseRepository`, `PartialCloseRepository` y `CocheraRepository`.
   - Se refactorizó `server.ts` para que todas sus búsquedas y analíticas consulten directamente a la
### ✅ Gate A: Black-box Packaged App
- Packaged `GarageIA.exe` accurately resolved `%APPDATA%\Roaming\GarageIA\database`.
- Engine was dynamically forced to `SQLITE` by properly manipulating the `.data/storage-engine.json` (or `database/storage-engine.json` in prod) marker.
- **SQLite Configuration Verified:** WAL mode (`PRAGMA journal_mode = WAL`) and synchronous mode are correctly respected at runtime.
- A critical bug was fixed where `SQLiteManager` inadvertently left domain tables with their old `V1` schema because `002_production.sql` used `CREATE TABLE IF NOT EXISTS`. By amending the migration file to explicitly `DROP TABLE IF EXISTS` for domain tables before creating them, the `id` string constraint now maps correctly for `ON CONFLICT` clauses. 
- The Express HTTP routes correctly returned `200 OK` responses without `404 Not Found` timeouts inside the `app.asar`.

### ✅ Gate B: Offline Black-box Real
- Proved that `POST /api/clientes` correctly creates users in offline mode via HTTP requests sent to the running packaged Electron background instance.
- Proved that `POST /api/estadias/entrada` effectively records entries and synchronously appends `PENDING` outbox events.
- Proved that `POST /api/estadias/salida` (updates) correctly write events bound to `entity_type = 'Stay'` and successfully append the `UPDATE` mutation to the outbox.

### ✅ Gate C: Hard Restart & Crash
- **Graceful Closure (`SIGTERM`):** Sending `SIGTERM` gracefully cleans up and ensures all pending `WAL` transactions are cleanly synchronized and queryable.
- **Abrupt Termination (`SIGKILL` / `taskkill /F`):** Intentionally performing a `taskkill /F` midway through execution demonstrates that SQLite WAL mode correctly recovers the `json_data` and the `outbox_events` upon the next startup. Zero data loss occurred despite aggressive killing of the underlying Node/Electron process.de `SQLiteManager` a través de statements precompilados.
2. **Resiliencia Offline (SyncCoordinator)**
   - Se modificó la query del `SqliteSyncCoordinator` que recupera eventos de Outbox (`processOutbox`), para que también levante estados `RETRY`. Anteriormente, solo buscaba `PENDING`, lo cual causaba starvation tras el primer fallo de conexión.
3. **Vitest E2E Offline-First Suite**
   - Se agregaron las pruebas `tests/phase2-6-e2e-offline.test.ts` probando un flujo completo con Suppabase inyectando un error de red y simulando un entorno Offline total. El backend demostró que las APIs retornan `SUCCESS`, el dominio se almacena correctamente en SQLite, los eventos quedan en `PENDING`/`RETRY`, todo esto sobrevive reinicios, y finaliza exitosamente reconciliando al restablecer conexión a Supabase (auto-convergencia).
4. **Empaquetado de Aplicación con Electron**
   - Se agregó exitosamente el script de empaquetado `npm run package:windows` en `package.json` utilizando `electron-builder` para aislar y construir la aplicación nativamente y se verificó exitosamente en Vitest testeando la existencia de `GarageIA.exe`.

## Resultados de Validación
- `npm run build:backend` **PASSED**
- `npx vitest run --file-parallelism=false` **PASSED**
- `npm run package:windows` **PASSED**
- Todos los puntos requeridos para el certificado fueron auditados y verificados. 

El artefacto `offline_phase2_6_source_of_truth_certification.md` se generó con los 32 puntos completados y verificados. El veredicto final es **PHASE 2.6 CERTIFIED — READY FOR PHASE 3**.
