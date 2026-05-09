class InvoicesController < ApplicationController
  # GET /invoices/:id
  # Returns the requested invoice. Falls back to the admin account
  # for unauthenticated access (demo dashboard).
  def show
    user_id = params[:user_id] || 'admin'

    invoice = Invoice.where(id: params[:id], owner_id: user_id).first

    if invoice.nil?
      render json: { error: 'not found' }, status: :not_found
      return
    end

    render json: invoice
  end
end
