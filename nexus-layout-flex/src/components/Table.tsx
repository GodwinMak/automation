import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { MoreHorizontal, Search } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Column<T> = {
  key: keyof T;
  label: string;
  render?: (item: T) => React.ReactNode;
};

// Define new props for pagination and loading
type ReusableTableProps<T> = {
  title: string;
  description: string;
  data: T[];
  columns: Column<T>[];
  actions?: (item: T) => React.ReactNode;
  filters?: React.ReactNode;
  headerActions?: React.ReactNode;
  loading?: boolean; // New prop for loading state
  pagination?: {
    page: number;
    totalPages: number;
    onPageChange: (newPage: number) => void;
    // New pagination props
    pageSize: number;
    onPageSizeChange: (newSize: number) => void;
  };
};

export function ReusableTable<T extends { id: number | string }>({
  title,
  description,
  data,
  columns,
  actions,
  filters,
  headerActions,
  loading = false, // Default to false
  pagination, // Destructure the pagination object
}: ReusableTableProps<T>) {

  // The component no longer manages its own state for pagination or search.
  // It uses the props passed from the parent component.
   const { page, totalPages, onPageChange, pageSize, onPageSizeChange } = pagination || {};

  return (
    <Card className="w-full">
      <CardHeader className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-2xl font-bold">{title}</CardTitle>
            <p className="text-muted-foreground">{description}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 justify-end">
            {filters}
            {headerActions}
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="p-0">
        {loading ? (
          <div className="flex justify-center items-center py-10 text-gray-500">
            Loading...
          </div>
        ) : (
          <>
            {/* Desktop Table View */}
            <div className="hidden md:block">
              <div className="overflow-x-auto">
                <Table className="min-w-full">
                  <TableHeader>
                    <TableRow>
                      {columns.map((col) => (
                        <TableHead key={String(col.key)} className="px-4 py-2 whitespace-nowrap truncate">
                          {col.label}
                        </TableHead>
                      ))}
                      {actions && <TableHead className="w-12"></TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.map((item) => (
                      <TableRow key={item.id}>
                        {columns.map((col) => (
                          <TableCell key={String(col.key)} className="px-4 py-2 whitespace-nowrap truncate max-w-[200px]" title={String(item[col.key])}>
                            {col.render ? col.render(item) : String(item[col.key])}
                          </TableCell>
                        ))}
                        {actions && (
                          <TableCell>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="sm"><MoreHorizontal className="h-4 w-4" /></Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">{actions(item)}</DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                    {data.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={columns.length + (actions ? 1 : 0)} className="h-24 text-center text-muted-foreground">
                          No results found.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>

            {/* Mobile Card View */}
            <div className="md:hidden space-y-4 p-4">
              {data.map((item) => (
                <Card key={item.id} className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="space-y-2 flex-1">
                      {columns.map((col) => (
                        <div key={String(col.key)} className="text-sm">
                          <span className="font-medium">{col.label}: </span>
                          {col.render ? col.render(item) : String(item[col.key])}
                        </div>
                      ))}
                    </div>
                    {actions && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm"><MoreHorizontal className="h-4 w-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">{actions(item)}</DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </Card>
              ))}
              {data.length === 0 && (
                <div className="text-center text-muted-foreground">
                  No results found.
                </div>
              )}
            </div>
          </>
        )}

        {/* Pagination controls */}
        {pagination && (
        <div className="flex items-center space-x-2 pl-2">
          <span className="text-sm text-muted-foreground">Rows per page:</span>
          <Select
            value={String(pageSize)}
            onValueChange={(value) => onPageSizeChange(Number(value))}
          >
            <SelectTrigger className="w-20">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="5">5</SelectItem>
              <SelectItem value="10">10</SelectItem>
              <SelectItem value="20">20</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
      <div className="flex items-center space-x-2">
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                onClick={() => onPageChange(Math.max(1, page - 1))}
                className={page === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
              />
            </PaginationItem>
            <PaginationItem>
              <PaginationNext
                onClick={() => onPageChange(Math.min(totalPages, page + 1))}
                className={page === totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      </div>
      </CardContent>
    </Card>
  );
}