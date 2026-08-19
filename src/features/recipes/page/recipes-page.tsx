"use client";

import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { DeleteDialog } from "../components/delete-dialog";
import { RecipeEditorModal } from "../components/recipe-editor-modal";
import { RecipeViewModal } from "../components/recipe-view-modal";
import { RecipesTable } from "../components/recipes-table";
import { RecipesToolbar } from "../components/recipes-toolbar";
import { useRecipes } from "../hooks/use-recipes";

export function RecipesPage() {
  const {
    items,
    totalCount,
    hasActiveFilters,
    ingredients,
    componentRecipes,
    loading,
    error,
    search,
    setSearch,
    sortField,
    sortDirection,
    toggleSort,
    isModalOpen,
    editingRecipe,
    initialFormValues,
    isLoadingRecipe,
    isViewModalOpen,
    viewingRecipe,
    isLoadingViewRecipe,
    viewError,
    deleteTarget,
    isSaving,
    isDeleting,
    actionError,
    photoError,
    openCreateModal,
    openEditModal,
    closeModal,
    openViewModal,
    closeViewModal,
    editFromView,
    openDeleteDialog,
    closeDeleteDialog,
    saveRecipe,
    deleteRecipe,
    retry,
  } = useRecipes();

  return (
    <DashboardLayout activePath="/recipes">
      <div className="mx-auto max-w-7xl space-y-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl">
            Recipes
          </h1>
          <p className="mt-2 text-base text-zinc-600 sm:text-lg">
            Define recipe bills of materials for production. Inventory stock is
            not changed here.
          </p>
        </div>

        <RecipesToolbar
          search={search}
          onSearchChange={setSearch}
          onCreateClick={openCreateModal}
        />

        <RecipesTable
          items={items}
          totalCount={totalCount}
          hasActiveFilters={hasActiveFilters}
          loading={loading}
          error={error}
          sortField={sortField}
          sortDirection={sortDirection}
          onSort={toggleSort}
          onRetry={retry}
          onCreateClick={openCreateModal}
          onView={(item) => void openViewModal(item)}
          onEdit={(item) => void openEditModal(item)}
          onDelete={openDeleteDialog}
        />

        <RecipeEditorModal
          isOpen={isModalOpen}
          recipe={editingRecipe}
          initialValues={initialFormValues}
          ingredients={ingredients}
          componentRecipes={componentRecipes}
          isLoading={isLoadingRecipe}
          isSaving={isSaving}
          error={actionError}
          photoError={photoError}
          onClose={closeModal}
          onSave={saveRecipe}
        />

        <RecipeViewModal
          isOpen={isViewModalOpen}
          recipe={viewingRecipe}
          isLoading={isLoadingViewRecipe}
          error={viewError}
          onClose={closeViewModal}
          onEdit={editFromView}
        />

        <DeleteDialog
          item={deleteTarget}
          isDeleting={isDeleting}
          error={actionError}
          onClose={closeDeleteDialog}
          onConfirm={deleteRecipe}
        />
      </div>
    </DashboardLayout>
  );
}
