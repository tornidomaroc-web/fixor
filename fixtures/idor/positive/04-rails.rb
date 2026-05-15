# ASSUMED-PATH: app/controllers/projects_controller.rb

class ProjectsController < ApplicationController
  before_action :authenticate_user!

  def show
    @project = Project.find_by(id: params[:id])

    if @project.nil?
      render json: { error: "Project not found" }, status: :not_found
      return
    end

    render json: {
      id: @project.id,
      name: @project.name,
      description: @project.description,
      created_at: @project.created_at,
      updated_at: @project.updated_at,
    }
  end

  def update
    project = Project.find_by(id: params[:id])

    if project.nil?
      render json: { error: "Project not found" }, status: :not_found
      return
    end

    if project.update(project_params)
      render json: project
    else
      render json: { errors: project.errors }, status: :unprocessable_entity
    end
  end

  private

  def project_params
    params.require(:project).permit(:name, :description)
  end
end
