// ASSUMED-PATH: src/customers/customers.controller.ts

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

interface UpdateCustomerDto {
  name?: string;
  industry?: string;
  notes?: string;
}

@Controller("customers")
@UseGuards(JwtAuthGuard)
export class CustomersController {
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
    @Body() dto: UpdateCustomerDto,
  ) {
    const customer = await this.customerModel.findById(id);
    if (!customer) {
      throw new NotFoundException("Customer not found");
    }
    Object.assign(customer, dto);
    return customer.save();
  }
}
