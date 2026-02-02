import { VehicleModel } from '../../../infrastructure/database/models';
import { Vehicle } from '../../../shared/schemas';

export class VehicleRepository {
    /**
     * Guarda o actualiza un vehículo.
     * Utiliza upsert basado en ID.
     */
    async save(vehicle: Vehicle): Promise<Vehicle> {
        // Usamos findOneAndUpdate con upsert: true para crear si no existe o actualizar.
        // Retornamos el documento nuevo (new: true).

        const result = await VehicleModel.findOneAndUpdate(
            { id: vehicle.id },
            vehicle,
            { new: true, upsert: true }
        );

        // Mongoose retorna un documento Mongoose, lo convertimos a objeto plano
        // para cumplir con la interfaz Vehicle pura.
        return result.toObject() as Vehicle;
    }

    async findById(id: string): Promise<Vehicle | null> {
        const result = await VehicleModel.findOne({ id });
        return result ? (result.toObject() as Vehicle) : null;
    }

    async findByPlate(plate: string): Promise<Vehicle | null> {
        const result = await VehicleModel.findOne({ plate }); // Case insensitive? Mongo es cs por defecto
        // Idealmente normalizar plate antes de query. El schema obliga uppercase.
        return result ? (result.toObject() as Vehicle) : null;
    }
}
