"use client"

import { useMemo, useState } from "react"
import { Check, ChevronsUpDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"

export interface TankComboboxOption {
  id: string
  name: string
  latitude?: number | null
  longitude?: number | null
}

interface TankComboboxProps {
  value: string
  onChange: (tankId: string) => void
  options: TankComboboxOption[]
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
}

export function TankCombobox({
  value,
  onChange,
  options,
  placeholder = "Select a tank…",
  searchPlaceholder = "Search tanks…",
  emptyText = "No tanks match your search.",
}: TankComboboxProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")

  const sortedOptions = useMemo(
    () =>
      [...options].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
      ),
    [options]
  )

  const namesById = useMemo(
    () => new Map(sortedOptions.map((option) => [option.id, option.name])),
    [sortedOptions]
  )

  const selectedName = namesById.get(value)

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen) setSearch("")
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="h-10 w-full justify-between rounded-xl border-slate-200/80 bg-slate-50/60 px-3 font-normal text-sm hover:bg-slate-50"
        >
          <span className={cn("truncate", !selectedName && "text-slate-400")}>
            {selectedName || placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 text-slate-400" />
        </Button>
      </PopoverTrigger>
<PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0 max-h-[400px] overflow-hidden" align="start">
        <Command
          filter={(optionValue, query) => {
            const name = namesById.get(optionValue) || ""
            return name.toLowerCase().includes(query.trim().toLowerCase()) ? 1 : 0
          }}
        >
          <CommandInput
            placeholder={searchPlaceholder}
            value={search}
            onValueChange={setSearch}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false)
            }}
          />
          <CommandList className="max-h-[320px] overflow-y-auto">
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {sortedOptions.map((option) => (
                <CommandItem
                  key={option.id}
                  value={option.id}
                  onSelect={(optionId) => {
                    onChange(optionId === value ? "" : optionId)
                    setOpen(false)
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === option.id ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <span className="truncate">
                    {option.name}
                    {option.latitude != null && option.longitude != null && (
                      <span className="ml-2 text-xs text-slate-400 font-normal">
                        ({option.latitude.toFixed(4)}°, {option.longitude.toFixed(4)}°)
                      </span>
                    )}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
