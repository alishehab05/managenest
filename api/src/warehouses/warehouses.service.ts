import { ConflictException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Types, type Model } from 'mongoose';
import { CompaniesService } from '../companies/companies.service.js';
import { CreateWarehouseDto } from './dto/create-warehouse.dto.js';
import { Warehouse } from './schemas/warehouse.schema.js';

@Injectable()
export class WarehousesService {
  constructor(
    @InjectModel(Warehouse.name)
    private readonly warehouses: Model<Warehouse>,
    private readonly companies: CompaniesService,
  ) {}

  async listForUser(clerkUserId: string) {
    const companyId = await this.companies.requireCompanyId(clerkUserId);
    return this.warehouses
      .find({ companyId, status: 'active' })
      .sort({ name: 1 })
      .lean();
  }

  async createForUser(clerkUserId: string, input: CreateWarehouseDto) {
    const companyId = await this.companies.requireCompanyId(clerkUserId);
    try {
      return await this.warehouses.create({
        companyId,
        code: input.code.trim().toUpperCase(),
        name: input.name.trim(),
        location: input.location?.trim() ?? '',
        address: input.address?.trim() ?? '',
        lowStockThresholdKg: input.lowStockThresholdKg === undefined
          ? null
          : Types.Decimal128.fromString(String(input.lowStockThresholdKg)),
      });
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 11000
      ) {
        throw new ConflictException('A warehouse with this code already exists');
      }
      throw error;
    }
  }
}
