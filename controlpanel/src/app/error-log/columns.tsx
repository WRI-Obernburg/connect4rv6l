"use client"

import { ColumnDef } from "@tanstack/react-table"
import {ErrorDescription, ErrorType} from "@/app/models/GameData";

export const columns: ColumnDef<ErrorDescription>[] = [
    {
        header: "ID",
        cell: ({ row }) => {
            const id = row.id
            return (
                <span className="text-gray-700 font-mono">
                    {id ? id : "N/A"}
                </span>
            );
        }
    },
    {
        accessorKey: "errorType",
        header: "Error Type",
        cell: ({ row }) => {
            const errorType = row.getValue("errorType");
            switch (errorType) {
                case ErrorType.INFO:
                    return <span className="text-blue-500">Info</span>;
                case ErrorType.WARNING:
                    return <span className="text-yellow-500">Warning</span>;
                case ErrorType.FATAL:
                    return <span className="text-red-500">Fatal</span>;
                default:
                    return <span className="text-gray-500">Unknown</span>;
            }
        }
    },
    {
        accessorKey: "date",
        header: "Timestamp",
        cell: ({ row }) => {
            const timestamp = row.getValue("date");
            return (
                <span className="text-gray-500">
                    {new Date(timestamp as string).toLocaleString()}
                </span>
            );
        }
    },
    {
        accessorKey: "description",
        header: "Description",
    },

]