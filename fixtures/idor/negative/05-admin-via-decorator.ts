// ASSUMED-PATH: src/admin/customers-admin.controller.ts

import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  NotFoundException,
  UseGuards,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";

import { Customer, CustomerDocument } from "./customer.schema";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { Roles } from "../auth/roles.decorator";

interface AdminUpdateCustomerDto {
  notes?: string;
  flagged?: boolean;
}

@Controller("admin/customers")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("admin")
export class CustomersAdminController {
  constructor(
    @InjectModel(Customer.name)
    private readonly customerModel: Model<CustomerDocument>,
  ) {}

  @Get(":id")
  async findOne(@Param("id") id: string) {
    const customer = await this.customerModel.findById(id);
    if (!customer) {
      throw new NotFoundException("Customer not found");
    }
    return customer;
  }

  @Patch(":id")
  async update(
    @Param("id") id: string,
    @Body() dto: AdminUpdateCustomerDto,
  ) {
    const customer = await this.customerModel.findById(id);
    if (!customer) {
      throw new NotFoundException("Customer not found");
    }
    Object.assign(customer, dto);
    return customer.save();
  }
}
