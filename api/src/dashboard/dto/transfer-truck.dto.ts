import { IsMongoId } from 'class-validator';

export class TransferTruckDto {
  @IsMongoId()
  warehouseId: string;
}
