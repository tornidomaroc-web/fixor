# ASSUMED-PATH: src/app/handlers/auth-bypass/10-rb-admin-fallback.rb
class InvoicesController < ApplicationController
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
