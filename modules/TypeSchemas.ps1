# Static content-type schema, modeled on the conventions observed in the user's
# real Obsidian vault (tag letters, frontmatter fields, folder shape) -- NOT
# fetched from that vault at runtime. This is a template, not a live mirror.

$script:TypeSchemas = [ordered]@{
    Location = @{
        tag             = "A"
        folderTemplate  = "Locations/{location}/Areas of Interest"
        fields          = @()
        label           = "Location / Area"
    }
    Entity = @{
        tag             = "E"
        folderTemplate  = "Entities/{disposition}"
        fields          = @("Location", "Alignment")
        label           = "Entity (NPC / Creature)"
    }
    Religion = @{
        tag             = "R"
        folderTemplate  = "Religion"
        fields          = @()
        label           = "Religion / Faction"
    }
    Quest = @{
        tag             = "Q"
        folderTemplate  = "Locations/{location}/Quests"
        fields          = @("Location", "Level")
        label           = "Quest"
    }
    Item = @{
        tag             = "I"
        folderTemplate  = "Items/{category}"
        fields          = @("Damage", "Damage_Type", "Weight", "Cost", "Additional_Damage", "Affinity")
        label           = "Item"
    }
    Material = @{
        tag             = "I"
        folderTemplate  = "Materials/{category}"
        fields          = @("Weight", "Cost")
        label           = "Material"
    }
    Spell = @{
        tag             = "S"
        folderTemplate  = "Spells"
        fields          = @()
        label           = "Spell"
    }
    StatusEffect = @{
        tag             = "S"
        folderTemplate  = "Status Effects"
        fields          = @()
        label           = "Status Effect"
    }
}
