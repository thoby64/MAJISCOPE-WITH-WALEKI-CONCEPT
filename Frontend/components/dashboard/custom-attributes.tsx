"use client"

import { useFormContext, useFieldArray } from "react-hook-form"
import { Plus, Trash2, Info } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"

export function CustomAttributes() {
  const { control, watch } = useFormContext()
  const { fields, append, remove } = useFieldArray({
    control,
    name: "custom_attributes",
  })

  return (
    <Card className="border-slate-200 shadow-sm">
      <CardContent className="p-6 space-y-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Info className="h-5 w-5 text-sky-600" />
            <h3 className="text-lg font-semibold text-slate-800">Custom Attributes</h3>
          </div>
          <Button 
            type="button" 
            variant="outline" 
            size="sm" 
            onClick={() => append({ key: '', value: '' })}
            className="rounded-lg"
          >
            <Plus className="mr-2 h-4 w-4" />
            Add Attribute
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-4">
          {fields.map((field, index) => (
            <div key={field.id} className="flex items-center gap-3 p-3 rounded-xl border border-slate-100 bg-slate-50/50 w-full">
              <div className="flex-1 grid grid-cols-2 gap-2 w-full">
                <Input 
                  placeholder="Attribute Name" 
                  {...watch(`custom_attributes.${index}.key`)} 
                  className="h-9 w-full"
                />
                <Input 
                  placeholder="Value" 
                  {...watch(`custom_attributes.${index}.value`)} 
                  className="h-9 w-full"
                />
              </div>
              <Button 
                type="button" 
                variant="ghost" 
                size="icon" 
                onClick={() => remove(index)}
                className="text-slate-400 hover:text-red-500 flex-shrink-0"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          {fields.length === 0 && (
            <p className="text-sm text-slate-400 italic py-4 text-center col-span-2">
              No custom attributes added. Click "Add Attribute" to add more.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}