"use client"

import { ColumnDef } from "@tanstack/react-table"

export const columns: ColumnDef<{
    frontendID: string;
    indoor: boolean;
}>[] = [
    {
        accessorKey: "frontendID",
        header: "Display ID",
    },
    {
        accessorKey: "indoor",
        header: "Betriebsmodus",
        cell: ({ row }) => {
            const type = row.getValue("indoor");
            return type ? "Indoor" : "Outdoor";
        }
    },



]