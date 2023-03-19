package com.wb.wbdataback.bean.request;


import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class PageEntity {

    private int page;
    private int size;
}
